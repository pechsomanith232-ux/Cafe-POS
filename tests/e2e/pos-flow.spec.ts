import { expect, test } from "@playwright/test";
import { OWNER, PIN } from "./fixtures";

// Plan Phase 9: login → open shift → sell → split pay KHR/USD → refund → close shift.
test("a full shift at the till", async ({ page }) => {
  // Receipts open in new tabs; the test doesn't need them.
  page.context().on("page", (popup) => void popup.close());

  await test.step("log in", async () => {
    await page.goto("/pos");
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/pos/);
  });

  await test.step("open a shift with a $50 float", async () => {
    await page.getByLabel("Opening float USD").fill("50");
    await page.getByRole("button", { name: "Open shift" }).click();
    await expect(page.getByTestId("cart-total")).toBeVisible();
  });

  await test.step("sell 4 lattes = $10.00", async () => {
    const latte = page.getByRole("button", { name: /Latte/ }).first();
    for (let i = 0; i < 4; i++) await latte.click();
    await expect(page.getByTestId("cart-total")).toContainText("$10.00");
    await expect(page.getByTestId("cart-total-khr")).toContainText("41,000");
  });

  await test.step("split payment: $5 cash + 20,500 riel (plan §4.4)", async () => {
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    const pay = page.getByRole("dialog");
    await pay.getByRole("button", { name: "$5.00", exact: true }).click();
    await expect(pay.getByTestId("remaining")).toContainText("$5.00");
    await pay.getByRole("button", { name: "Riel ៛" }).click();
    await pay.getByLabel("Payment amount").fill("20500");
    await pay.getByRole("button", { name: "Add", exact: true }).click();
    await expect(pay.getByTestId("tender")).toHaveCount(2);
    await expect(pay.getByTestId("remaining")).toContainText("$0.00");
    await pay.getByRole("button", { name: "Complete payment" }).click();
    await expect(page.getByTestId("change-due")).toHaveText("$0.00");
    await page.getByRole("button", { name: "New order" }).click();
    await expect(page.getByTestId("order-label")).toHaveText("New order");
  });

  await test.step("refund one latte with the manager PIN", async () => {
    await page.getByRole("button", { name: "POS menu" }).click();
    await page.getByRole("menuitem", { name: /Recent orders/ }).click();
    await page.getByRole("button", { name: "Refund", exact: true }).click();
    await page.getByRole("button", { name: "More Latte" }).click();
    await page.getByLabel("Refund reason").fill("Wrong drink made");
    await page.getByRole("button", { name: "Refund…" }).click();
    await page.getByLabel("PIN").fill(PIN);
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page.getByText("Refunded $2.50.")).toBeVisible();
  });

  await test.step("close the shift: cash matches (50 + 5 − 2.50, and 20,500 riel)", async () => {
    await page.getByRole("button", { name: "POS menu" }).click();
    await page.getByRole("menuitem", { name: "Close shift" }).click();
    await page.getByLabel("Counted USD").fill("52.50");
    await page.getByLabel("Counted KHR").fill("20500");
    await page.getByRole("button", { name: "Close shift" }).click();
    const summary = page.getByTestId("close-summary");
    await expect(summary).toContainText("expected $52.50");
    await expect(summary).toContainText("counted $52.50");
    await expect(summary).toContainText("20,500");
    await page.getByRole("button", { name: "Done" }).click();
    // Back to "open a shift": nothing can be sold without one.
    await expect(page.getByRole("button", { name: "Open shift" })).toBeVisible();
  });
});
