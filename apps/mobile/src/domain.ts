import { ApiError, record, string } from "./api";
export function items(value: unknown): { id: string; title: string; description?: string }[] {
  if (value && typeof value === "object" && !Array.isArray(value)) value = record(value).items;
  if (!Array.isArray(value)) throw new ApiError("invalid");
  return value.map((entry: unknown) => {
    const x = record(entry);
    return {
      id: string(x.courseId ?? x.classId ?? x.offeringId ?? x.notificationId),
      title: string(x.title ?? x.name ?? x.courseTitle ?? x.subject),
      ...(typeof x.body === "string" ? { description: x.body } : {}),
    };
  });
}
