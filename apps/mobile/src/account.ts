import { ApiError, record, string } from "./api";

export interface UserProfile {
  userId: string;
  displayName: string;
  emailMasked: string;
  role: string;
  status: string;
  lecturerVerified: boolean;
  profileVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileUpdateResponse {
  userId: string;
  profileVersion: number;
  updated: boolean;
  noOp: boolean;
}

export interface AvatarResponse {
  dataUrl: string | null;
}

export interface PasswordChangeResponse {
  passwordChanged: boolean;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new ApiError("invalid");
}

export function userProfile(value: unknown): UserProfile {
  const data = record(value);
  return {
    userId: string(data.userId),
    displayName: string(data.displayName),
    emailMasked: string(data.emailMasked),
    role: string(data.role),
    status: string(data.status),
    lecturerVerified: Boolean(data.lecturerVerified),
    profileVersion: typeof data.profileVersion === "number" ? data.profileVersion : 1,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
  };
}

export function profileUpdateResponse(value: unknown): ProfileUpdateResponse {
  const data = record(value);
  return {
    userId: string(data.userId),
    profileVersion: parseNumber(data.profileVersion),
    updated: Boolean(data.updated),
    noOp: Boolean(data.noOp),
  };
}

export function avatarResponse(value: unknown): AvatarResponse {
  const data = record(value);
  const dataUrl = data.dataUrl === null || data.dataUrl === undefined ? null : string(data.dataUrl);
  return { dataUrl };
}

export function passwordChangeResponse(value: unknown): PasswordChangeResponse {
  const data = record(value);
  return {
    passwordChanged: Boolean(data.passwordChanged),
  };
}

export function validateDisplayName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 1) {
    return { valid: false, error: "Họ tên không được để trống." };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: "Họ tên không được vượt quá 100 ký tự." };
  }
  return { valid: true };
}

export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
): { valid: boolean; error?: string } {
  if (!currentPassword) {
    return { valid: false, error: "Vui lòng nhập mật khẩu hiện tại." };
  }
  if (!newPassword || newPassword.length < 8) {
    return { valid: false, error: "Mật khẩu mới phải có ít nhất 8 ký tự." };
  }
  if (currentPassword === newPassword) {
    return { valid: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại." };
  }
  return { valid: true };
}

const MAX_AVATAR_BYTES = 256 * 1024;

export function validateAvatarDataUrl(dataUrl: string | null): { valid: boolean; error?: string } {
  if (dataUrl === null) return { valid: true };
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) {
    return { valid: false, error: "Định dạng ảnh không hỗ trợ (chỉ chấp nhận PNG, JPEG, WebP)." };
  }
  const base64Data = match[2];
  // Calculate decoded byte length from base64 string length
  const approxBytes = Math.ceil((base64Data.length * 3) / 4);
  if (approxBytes > MAX_AVATAR_BYTES) {
    return { valid: false, error: "Kích thước ảnh vượt quá 256 KiB." };
  }
  return { valid: true };
}
