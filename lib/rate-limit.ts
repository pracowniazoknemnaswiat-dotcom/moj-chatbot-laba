// Licznik w pamięci jednego procesu. Na hostingu (np. Vercel) każda instancja
// ma własną pamięć, więc to tylko lokalne spowolnienie, a nie globalna ochrona.
// Globalnie ogranicz próby regułą rate limit w firewallu hostingu.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 5;
const MAX_FAILURES_TOTAL = 50;

type Entry = { count: number; resetAt: number };

const failuresByIp = new Map<string, Entry>();
const totalFailures: Entry = { count: 0, resetAt: 0 };

function current(entry: Entry | undefined, now: number): Entry {
  if (!entry || entry.resetAt <= now) return { count: 0, resetAt: now + WINDOW_MS };
  return entry;
}

export function isLoginBlocked(ip: string): boolean {
  const now = Date.now();
  return (
    current(failuresByIp.get(ip), now).count >= MAX_FAILURES_PER_IP ||
    current(totalFailures, now).count >= MAX_FAILURES_TOTAL
  );
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = current(failuresByIp.get(ip), now);
  entry.count += 1;
  failuresByIp.set(ip, entry);

  const total = current(totalFailures, now);
  totalFailures.count = total.count + 1;
  totalFailures.resetAt = total.resetAt;
}

export function clearLoginFailures(ip: string): void {
  failuresByIp.delete(ip);
}
