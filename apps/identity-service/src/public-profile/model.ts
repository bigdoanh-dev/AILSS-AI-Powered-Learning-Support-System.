export const PUBLIC_PROFILE_BUSINESS_QUERY_IDS = ["Q-IDN-006"] as const;
export const PUBLIC_PROFILE_SECURITY_QUERY_IDS = ["Q-IDN-001"] as const;

export interface CanonicalPublicSubject {
  readonly userId: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  readonly lecturerVerified: boolean;
  readonly profileVersion: number;
}

export interface PublicLecturerProjection {
  readonly lecturerId: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarObjectKey: string | null;
  readonly experience?: string | null;
  readonly education?: string | null;
  readonly achievements?: string | null;
  readonly avatarPublic?: boolean;
  readonly verified: boolean;
  readonly profileVersion: number;
  readonly updatedAt: Date;
}

export interface PublicLecturerProfile {
  readonly lecturerId: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarRef: string | null;
  readonly experience?: string | null;
  readonly education?: string | null;
  readonly achievements?: string | null;
  readonly verified: true;
  readonly profileVersion: number;
}

export interface InternalPublicProfile {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarRef: null;
  readonly resourceVersion: number;
}

export function isPubliclyEligible(subject: CanonicalPublicSubject): boolean {
  return subject.role === "LECTURER" && subject.status === "ACTIVE" && subject.lecturerVerified;
}
