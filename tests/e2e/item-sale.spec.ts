import { expect, test } from "@playwright/test";
import { OWNER } from "./fixtures";

// Sell on POS: switch a stock item on from its page, and it can be rung up on the till.
test("a stock item switched to Sell on POS appears on the till at its price", async ({ page }) => {
  await page.goto("/en/inventory/items");
  // The form only signs in once its JavaScript has loaded (a cold dev compile can take a while).
  await page.waitForLoadState("networkidle");
  await page.locator("#email").fill(OWNER.email);
  await page.locator("#password").fill(OWNER.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/en\/inventory\/items$/);

  await page.getByRole("link", { name: "Fresh Milk" }).first().click();
  await expect(page).toHaveURL(/\/en\/inventory\/items\/[0-9a-f-]{36}$/);
  await page.getByRole("switch", { name: "Sell on POS" }).click();
  await page.getByLabel("Selling price (USD)").fill("1.50");
  await page.getByRole("button", { name: "Save selling settings" }).click();
  await expect(page.getByText("Selling settings saved.")).toBeVisible();

  await page.goto("/en/pos");
  await page.getByLabel("Opening float USD").fill("0");
  await page.getByRole("button", { name: "Open shift" }).click();
  await page.getByRole("button", { name: /Fresh Milk/ }).first().click();
  await expect(page.getByTestId("cart-total")).toContainText("$1.50");

  // Leave the register as we found it: clear the cart and close the empty shift.
  await page.getByRole("button", { name: "Remove Fresh Milk" }).click();
  await page.getByRole("button", { name: "POS menu" }).click();
  await page.getByRole("menuitem", { name: "Close shift" }).click();
  await page.getByRole("button", { name: "Close shift" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Open shift" })).toBeVisible();
});
