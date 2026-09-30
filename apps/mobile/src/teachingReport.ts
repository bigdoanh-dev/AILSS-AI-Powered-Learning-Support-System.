import { loadTeachingReport, type Read } from "../../../packages/teaching-report/src/report";
import type { Session } from "./session";

export { aggregateReport, reportCsv, ReportDataError } from "../../../packages/teaching-report/src/report";
export type { TeachingReport } from "../../../packages/teaching-report/src/report";

export function loadMobileTeachingReport(days: 30 | 90 | 365, signal: AbortSignal, session: Session) {
  const read: Read = async <T>(path: string, requestSignal: AbortSignal) => ({
    data: (await session.request(`/api/v1${path}`, { signal: requestSignal })) as T,
  });
  return loadTeachingReport(days, signal, read);
}
