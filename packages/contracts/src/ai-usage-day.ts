/** AI quota uses Vietnam calendar days, independent of the server's timezone. */
export const AI_USAGE_TIME_ZONE = "Asia/Ho_Chi_Minh";
const offsetMs = 7 * 60 * 60 * 1000;
export function aiUsageDay(now: Date): string {
  return new Date(now.getTime() + offsetMs).toISOString().slice(0, 10);
}
export function aiUsageResetsAt(now: Date): string {
  const day = aiUsageDay(now);
  return new Date(Date.parse(`${day}T00:00:00+07:00`) + 24 * 60 * 60 * 1000).toISOString();
}
