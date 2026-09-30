import { record, string } from "./api";
export type PublicLecturer = {
  lecturerId: string;
  displayName: string;
  bio: string | null;
  experience: string | null;
  education: string | null;
  achievements: string | null;
  avatarRef: string | null;
  verified: boolean;
};
export function publicLecturer(value: unknown): PublicLecturer {
  const r = record(value);
  return {
    lecturerId: string(r.lecturerId),
    displayName: string(r.displayName),
    bio: typeof r.bio === "string" ? r.bio : null,
    experience: typeof r.experience === "string" ? r.experience : null,
    education: typeof r.education === "string" ? r.education : null,
    achievements: typeof r.achievements === "string" ? r.achievements : null,
    avatarRef:
      typeof r.avatarRef === "string" && /^data:image\/(?:png|jpeg|webp);base64,/u.test(r.avatarRef)
        ? r.avatarRef
        : null,
    verified: r.verified === true,
  };
}
