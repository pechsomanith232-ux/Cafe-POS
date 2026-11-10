import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";

// Review #5: names change only through the audited users service.
describe("Better Auth endpoints", () => {
  it("disables self-service /update-user (404, not 401)", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "Someone else" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses public sign-up", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "X", email: "x@test.local", password: "xxxx-pass-1" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
