import { expect, test } from "@playwright/test";
import { OWNER } from "./fixtures";

// Before the page's JavaScript runs (slow network, still compiling in dev), the browser
// submits the form itself. The credentials must never end up in the URL, where they
// would be saved in browser history and server logs.
test.use({ javaScriptEnabled: false });

test("submitting the login form without JavaScript keeps the password out of the URL", async ({ page }) => {
  await page.goto("/en/login");
  await page.locator("#email").fill(OWNER.email);
  await page.locator("#password").fill(OWNER.password);
  await Promise.all([page.waitForLoadState("load"), page.locator('button[type="submit"]').click()]);
  await page.waitForLoadState("load");

  expect(page.url()).not.toContain("password");
  expect(page.url()).not.toContain(encodeURIComponent(OWNER.password));
});
