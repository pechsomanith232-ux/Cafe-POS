-- Phase 7: refund restock movements point at the refund LINE (ref_type 'refund_line')
-- so profit reports can attribute them to a product. Re-point rows written before
-- this change (ref_type 'refund', ref_id = refund id): each goes to the restocked
-- line of that refund whose sale moved the same item (the first such line if two
-- lines of one refund share an item — the total is unchanged either way).
ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_no_update_delete;
--> statement-breakpoint
UPDATE stock_movements m
SET ref_type = 'refund_line', ref_id = x.refund_line_id::text
FROM (
  SELECT DISTINCT ON (m2.id) m2.id AS movement_id, rl.id AS refund_line_id
  FROM stock_movements m2
  JOIN refund_lines rl ON rl.refund_id::text = m2.ref_id AND rl.restock
  WHERE m2.ref_type = 'refund'
    AND EXISTS (SELECT 1 FROM stock_movements s WHERE s.ref_type = 'order_line' AND s.ref_id = rl.order_line_id::text AND s.item_id = m2.item_id)
  ORDER BY m2.id, rl.id
) x
WHERE m.id = x.movement_id;
--> statement-breakpoint
ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_no_update_delete;
