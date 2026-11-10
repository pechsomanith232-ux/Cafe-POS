"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PickItem = { id: string; name: string; isActive: boolean };

/** Searchable item picker for recipe lines (plan §6: item search). Retired items stay visible, labelled. */
export function ItemPicker({ items, value, onChange, label, disabled }: { items: PickItem[]; value: string; onChange: (id: string) => void; label: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = items.find((i) => i.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={label} disabled={disabled} className="w-full justify-between font-normal">
          <span className={cn("truncate", !current && "text-muted-foreground")}>
            {current ? `${current.name}${current.isActive ? "" : " (inactive)"}` : "Choose item…"}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search items…" />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            {items.map((it) => (
              <CommandItem key={it.id} value={`${it.name} ${it.id}`} onSelect={() => { onChange(it.id); setOpen(false); }}>
                <Check className={cn(it.id === value ? "opacity-100" : "opacity-0")} />
                {it.name}{!it.isActive && <span className="text-muted-foreground"> (inactive)</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
