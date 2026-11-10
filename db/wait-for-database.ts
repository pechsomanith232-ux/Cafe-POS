/**
 * Retry `ping` until it succeeds. `docker compose up` returns before
 * PostgreSQL finishes its first start, so scripts wait here instead of failing.
 */
export async function waitForDatabase(
  ping: () => Promise<unknown>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await ping();
      return;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Database not reachable after ${attempts} attempts: ${reason}`);
}
