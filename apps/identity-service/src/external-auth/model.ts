import { z } from "zod";
import type { SocialProvider } from "../../../../packages/security/src/index.js";

export type { SocialProvider };
export const socialProviderSchema = z.enum(["GOOGLE", "APPLE"]);

export const socialLoginRequestSchema = z.object({
  idToken: z.string().min(10).max(8192),
  clientProfile: z
    .object({
      firstName: z.string().trim().max(100).optional(),
      lastName: z.string().trim().max(100).optional(),
    })
    .optional(),
});

export type SocialLoginRequest = z.infer<typeof socialLoginRequestSchema>;

export const linkSocialRequestSchema = z.object({
  provider: socialProviderSchema,
  idToken: z.string().min(10).max(8192),
});

export type LinkSocialRequest = z.infer<typeof linkSocialRequestSchema>;

export interface ExternalIdentityRecord {
  readonly provider: SocialProvider;
  readonly providerSubject: string;
  readonly userId: string;
  readonly emailAtLinkTime: string;
  readonly profileSnapshot?: string;
  readonly createdAt: Date;
  readonly lastLoginAt: Date;
}

export interface UserLinkedProvider {
  readonly provider: SocialProvider;
  readonly providerSubject: string;
  readonly emailAtLinkTime: string;
  readonly linkedAt: Date;
}

export interface UserIdentitiesSummary {
  readonly userId: string;
  readonly hasPassword: boolean;
  readonly linkedProviders: readonly UserLinkedProvider[];
}

export interface SocialLoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: "Bearer";
  readonly accessExpiresAt: string;
  readonly refreshExpiresAt: string;
  readonly user: {
    readonly userId: string;
    readonly emailMasked: string;
    readonly displayName: string;
    readonly role: string;
    readonly status: string;
    readonly lecturerVerified: boolean;
  };
  readonly isNewUser: boolean;
}
