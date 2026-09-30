import { lecturerRequest } from "./api";
import {
  loadTeachingReport as loadSharedReport,
  type Read,
} from "../../../../packages/teaching-report/src/report";

export { aggregateReport, reportCsv, ReportDataError } from "../../../../packages/teaching-report/src/report";
export type { ReportClass, TeachingReport } from "../../../../packages/teaching-report/src/report";

const readFromApi: Read = (path, signal) => lecturerRequest(path, "GET", undefined, {}, signal);

export function loadTeachingReport(
  days: 30 | 90 | 365,
  signal: AbortSignal,
  read: Read = readFromApi,
  now = new Date(),
) {
  return loadSharedReport(days, signal, read, now);
}
