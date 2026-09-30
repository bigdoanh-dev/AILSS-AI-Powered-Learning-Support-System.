import path from "node:path";
import { AppError } from "../../http/src/index.js";

export interface ScormPostMessagePayload {
  readonly action:
    | "LMSInitialize"
    | "LMSFinish"
    | "LMSGetValue"
    | "LMSSetValue"
    | "LMSCommit"
    | "LMSGetLastError"
    | "LMSGetErrorString"
    | "LMSGetDiagnostic";
  readonly parameter?: string;
  readonly value?: string;
  readonly packageId: string;
  readonly attemptId: string;
}

export const ALLOWED_CMI_ELEMENTS = new Set([
  "cmi.core.lesson_status",
  "cmi.core.lesson_location",
  "cmi.core.score.raw",
  "cmi.core.score.min",
  "cmi.core.score.max",
  "cmi.core.session_time",
  "cmi.core.exit",
  "cmi.suspend_data",
  "cmi.comments",
]);

export const VALID_LESSON_STATUSES = new Set([
  "passed",
  "completed",
  "failed",
  "incomplete",
  "browsed",
  "not attempted",
]);

/**
 * Validates a zip entry file path to prevent Zip-Slip directory traversal attacks.
 * @param entryPath The relative path extracted from the zip archive header.
 * @param destinationDir The intended destination directory for extraction.
 * @returns The safely resolved target absolute path.
 */
export function sanitizeScormZipEntryPath(entryPath: string, destinationDir: string): string {
  if (!entryPath || typeof entryPath !== "string") {
    throw new AppError("INVALID_ZIP_ENTRY", 400, "Zip entry path is empty or invalid");
  }

  // Reject null bytes
  if (entryPath.includes("\0")) {
    throw new AppError(
      "ZIP_SLIP_ATTEMPT_DETECTED",
      400,
      "[ZIP_SLIP_ATTEMPT_DETECTED] Null byte detected in zip entry path",
    );
  }

  const resolvedDest = path.resolve(destinationDir);
  const resolvedTarget = path.resolve(resolvedDest, entryPath);

  // Must start with destination directory plus path separator, or equal it
  const isInside = resolvedTarget === resolvedDest || resolvedTarget.startsWith(resolvedDest + path.sep);
  if (!isInside) {
    throw new AppError(
      "ZIP_SLIP_ATTEMPT_DETECTED",
      400,
      `[ZIP_SLIP_ATTEMPT_DETECTED] Extraction path traversal attempt detected: ${entryPath}`,
    );
  }

  return resolvedTarget;
}

/**
 * Validates postMessage events from sandboxed SCORM iframes.
 * Verifies origin match and sanitizes CMI datamodel commands.
 */
export function validateScormPostMessage(
  origin: string,
  data: unknown,
  allowedOrigins: readonly string[],
): ScormPostMessagePayload {
  // 1. Origin verification
  const isAllowedOrigin = allowedOrigins.includes(origin);
  if (!isAllowedOrigin) {
    throw new AppError(
      "UNAUTHORIZED_POSTMESSAGE_ORIGIN",
      403,
      `[UNAUTHORIZED_POSTMESSAGE_ORIGIN] postMessage received from untrusted origin: ${origin}`,
    );
  }

  // 2. Payload structure validation
  if (!data || typeof data !== "object") {
    throw new AppError(
      "INVALID_SCORM_PAYLOAD",
      400,
      "[INVALID_SCORM_PAYLOAD] SCORM postMessage data must be an object",
    );
  }

  const payload = data as Partial<ScormPostMessagePayload>;
  const validActions = [
    "LMSInitialize",
    "LMSFinish",
    "LMSGetValue",
    "LMSSetValue",
    "LMSCommit",
    "LMSGetLastError",
    "LMSGetErrorString",
    "LMSGetDiagnostic",
  ];

  if (!payload.action || !validActions.includes(payload.action)) {
    throw new AppError(
      "INVALID_SCORM_ACTION",
      400,
      `[INVALID_SCORM_ACTION] Unknown SCORM action: ${String(payload.action)}`,
    );
  }

  if (!payload.packageId || typeof payload.packageId !== "string") {
    throw new AppError(
      "INVALID_SCORM_PACKAGE_ID",
      400,
      "[INVALID_SCORM_PACKAGE_ID] Missing or invalid packageId",
    );
  }

  if (!payload.attemptId || typeof payload.attemptId !== "string") {
    throw new AppError(
      "INVALID_SCORM_ATTEMPT_ID",
      400,
      "[INVALID_SCORM_ATTEMPT_ID] Missing or invalid attemptId",
    );
  }

  // 3. CMI Element & Value validation on LMSSetValue
  if (payload.action === "LMSSetValue") {
    const param = payload.parameter;
    if (!param || !ALLOWED_CMI_ELEMENTS.has(param)) {
      throw new AppError(
        "UNSUPPORTED_CMI_ELEMENT",
        400,
        `[UNSUPPORTED_CMI_ELEMENT] Unsupported or prohibited CMI element: ${String(param)}`,
      );
    }

    if (param === "cmi.core.lesson_status" && payload.value) {
      if (!VALID_LESSON_STATUSES.has(payload.value.toLowerCase())) {
        throw new AppError(
          "INVALID_LESSON_STATUS",
          400,
          `[INVALID_LESSON_STATUS] Invalid lesson_status value: ${payload.value}`,
        );
      }
    }

    if (param === "cmi.core.score.raw" && payload.value !== undefined) {
      const score = Number(payload.value);
      if (Number.isNaN(score) || score < 0 || score > 1000) {
        throw new AppError(
          "INVALID_SCORE_RANGE",
          400,
          `[INVALID_SCORE_RANGE] Invalid raw score value: ${payload.value}`,
        );
      }
    }
  }

  return {
    action: payload.action,
    packageId: payload.packageId,
    attemptId: payload.attemptId,
    ...(payload.parameter !== undefined ? { parameter: payload.parameter } : {}),
    ...(payload.value !== undefined ? { value: payload.value } : {}),
  };
}
