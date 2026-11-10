export type HealthBody = {
  status: "ok" | "error";
  db: "ok" | "down" | "timeout";
  time: string;
};

export type HealthResult = { httpStatus: 200 | 503; body: HealthBody };

const TIMED_OUT = Symbol("timeout");

/**
 * Health check used by Coolify and the uptime monitor (plan §9).
 * `pingDb` should run a trivial query. Error details are never returned,
 * because the endpoint is public.
 */
export async function checkHealth(
  pingDb: () => Promise<unknown>,
  options: { timeoutMs?: number } = {},
): Promise<HealthResult> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const time = new Date().toISOString();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const outcome = await Promise.race([
      pingDb().then(() => "ok" as const),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);
    if (outcome === TIMED_OUT) {
      return { httpStatus: 503, body: { status: "error", db: "timeout", time } };
    }
    return { httpStatus: 200, body: { status: "ok", db: "ok", time } };
  } catch {
    return { httpStatus: 503, body: { status: "error", db: "down", time } };
  } finally {
    clearTimeout(timer);
  }
}
