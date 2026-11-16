import { expect, test, type Page } from "@playwright/test";
import km from "../../messages/km.json";
import { OWNER } from "./fixtures";

// Fills the login form by field id, so it works in either language.
async function signIn(page: Page) {
  await page.locator("#email").fill(OWNER.email);
  await page.locator("#password").fill(OWNER.password);
  await page.locator('button[type="submit"]').click();
}

async function signedInAt(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  await signIn(page);
  await expect(page).not.toHaveURL(/\/login/);
}

test("/ goes to the English login when signed out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/:\d+\/en\/login(\?|$)/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("Khmer login page", async ({ page }) => {
  await page.goto("/km/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "km");
  await expect(page.locator('button[type="submit"]')).toHaveText(km.Login.submit);
  const font = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toContain("Noto Sans Khmer");
});

test("deep link returns after login in the same locale", async ({ page }) => {
  await page.goto("/km/inventory/items");
  await expect(page).toHaveURL(/:\d+\/km\/login\?next=/);
  await signIn(page);
  // Anchored to the port so /km/km/… (double prefix) fails.
  await expect(page).toHaveURL(/:\d+\/km\/inventory\/items$/);
});

test("sidebar links keep the locale", async ({ page }) => {
  await signedInAt(page, "/km/dashboard");
  await expect(page).toHaveURL(/:\d+\/km\/dashboard$/);
  const links = page.locator("aside a[href]");
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href).toMatch(/^\/km\//);
});

test("switching language keeps the page and query", async ({ page }) => {
  await signedInAt(page, "/en/inventory/movements?type=sale");
  await expect(page).toHaveURL(/:\d+\/en\/inventory\/movements\?type=sale$/);
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "ខ្មែរ" }).click();
  await expect(page).toHaveURL(/:\d+\/km\/inventory\/movements\?type=sale$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "km");
});

test("unknown locale and path are 404", async ({ page }) => {
  // Signed in, so the login redirect doesn't hide the 404.
  await signedInAt(page, "/en/dashboard");
  expect((await page.goto("/fr/pos"))?.status()).toBe(404);
  expect((await page.goto("/en/nope"))?.status()).toBe(404);
});
