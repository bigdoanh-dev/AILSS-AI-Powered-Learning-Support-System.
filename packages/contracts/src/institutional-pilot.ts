export const PILOT_INSTITUTION_ID = "tenant-pilot-polytech";

export const MOBILE_PILOT_SCOPE = "NOT_IN_SCOPE" as const;
export type MobilePilotScope = typeof MOBILE_PILOT_SCOPE;

export interface PilotScopeLock {
  readonly mobile: "NOT_IN_SCOPE";
  readonly payments: "SANDBOX_ONLY";
  readonly payouts: "GATED";
  readonly webApplication: "IN_SCOPE_ACTIVE";
  readonly aiAssistant: "IN_SCOPE_ACTIVE";
  readonly ltiIntegration: "IN_SCOPE_ACTIVE";
  readonly scimProvisioning: "IN_SCOPE_ACTIVE";
}

export const POLYTECH_PILOT_SCOPE_LOCK: PilotScopeLock = {
  mobile: "NOT_IN_SCOPE",
  payments: "SANDBOX_ONLY",
  payouts: "GATED",
  webApplication: "IN_SCOPE_ACTIVE",
  aiAssistant: "IN_SCOPE_ACTIVE",
  ltiIntegration: "IN_SCOPE_ACTIVE",
  scimProvisioning: "IN_SCOPE_ACTIVE",
};

export interface PilotInstitutionQuota {
  readonly maxActiveStudents: number;
  readonly maxMonthlyAiTokens: number;
  readonly storageQuotaBytes: number;
  readonly maxConcurrentClasses: number;
}

export interface PilotInstitutionConfig {
  readonly tenantId: string;
  readonly institutionName: string;
  readonly rootDomain: string;
  readonly allowedEmailDomains: readonly string[];
  readonly quota: PilotInstitutionQuota;
  readonly enabledFeatures: readonly string[];
  readonly pilotStatus: "ONBOARDING" | "ACTIVE" | "EVALUATION" | "GRADUATED";
  readonly authorizationReference?: string;
  readonly mobilePilotScope?: MobilePilotScope;
}

export const POLYTECH_PILOT_CONFIG: PilotInstitutionConfig = {
  tenantId: PILOT_INSTITUTION_ID,
  institutionName: "Trường Đại học Bách Khoa - Pilot Campus",
  rootDomain: "polytech.edu.vn",
  allowedEmailDomains: ["polytech.edu.vn", "student.polytech.edu.vn"],
  quota: {
    maxActiveStudents: 2500,
    maxMonthlyAiTokens: 50_000_000,
    storageQuotaBytes: 500 * 1024 * 1024 * 1024, // 500 GB
    maxConcurrentClasses: 120,
  },
  enabledFeatures: [
    "SSO_OIDC",
    "LTI_1_3",
    "ASSISTANT_ADVISOR",
    "PROCTORED_ASSESSMENT",
    "VERIFIED_CREDENTIALS",
    "ONEROSTER_SIS",
  ],
  pilotStatus: "ACTIVE",
  authorizationReference: "MOU-2026-POLYTECH-AILSS-001",
  mobilePilotScope: MOBILE_PILOT_SCOPE,
};

export const INCIDENT_SEVERITY_LEVELS = ["SEV0", "SEV1", "SEV2", "SEV3"] as const;
export type IncidentSeverityLevel = (typeof INCIDENT_SEVERITY_LEVELS)[number];

export interface IncidentSlaTarget {
  readonly severity: IncidentSeverityLevel;
  readonly mttdMinutes: number; // Mean Time to Detect
  readonly mttrMinutes: number; // Mean Time to Resolve
  readonly pagerDutyPaging: boolean;
  readonly executiveNotification: boolean;
  readonly statusPageUpdateIntervalMinutes: number;
}

export const INCIDENT_SLA_TAXONOMY: Record<IncidentSeverityLevel, IncidentSlaTarget> = {
  SEV0: {
    severity: "SEV0",
    mttdMinutes: 5,
    mttrMinutes: 30,
    pagerDutyPaging: true,
    executiveNotification: true,
    statusPageUpdateIntervalMinutes: 15,
  },
  SEV1: {
    severity: "SEV1",
    mttdMinutes: 15,
    mttrMinutes: 120,
    pagerDutyPaging: true,
    executiveNotification: false,
    statusPageUpdateIntervalMinutes: 30,
  },
  SEV2: {
    severity: "SEV2",
    mttdMinutes: 60,
    mttrMinutes: 480,
    pagerDutyPaging: false,
    executiveNotification: false,
    statusPageUpdateIntervalMinutes: 120,
  },
  SEV3: {
    severity: "SEV3",
    mttdMinutes: 1440,
    mttrMinutes: 4320,
    pagerDutyPaging: false,
    executiveNotification: false,
    statusPageUpdateIntervalMinutes: 0, // internal only
  },
};

export interface IncidentRecord {
  readonly incidentId: string;
  readonly severity: IncidentSeverityLevel;
  readonly title: string;
  readonly description: string;
  readonly affectedServices: readonly string[];
  readonly detectedAt: Date;
  readonly acknowledgedAt?: Date | undefined;
  readonly resolvedAt?: Date | undefined;
  readonly rootCause?: string | undefined;
}

export const IncidentLifecycleManager = {
  calculateSlaCompliance(incident: IncidentRecord): {
    readonly mttdCompliant: boolean;
    readonly mttrCompliant: boolean;
    readonly actualMttdMinutes?: number;
    readonly actualMttrMinutes?: number;
  } {
    const sla = INCIDENT_SLA_TAXONOMY[incident.severity];

    let actualMttdMinutes: number | undefined;
    let mttdCompliant = true;
    if (incident.acknowledgedAt) {
      actualMttdMinutes = Math.max(
        0,
        Math.round((incident.acknowledgedAt.getTime() - incident.detectedAt.getTime()) / 60000),
      );
      mttdCompliant = actualMttdMinutes <= sla.mttdMinutes;
    }

    let actualMttrMinutes: number | undefined;
    let mttrCompliant = true;
    if (incident.resolvedAt) {
      actualMttrMinutes = Math.max(
        0,
        Math.round((incident.resolvedAt.getTime() - incident.detectedAt.getTime()) / 60000),
      );
      mttrCompliant = actualMttrMinutes <= sla.mttrMinutes;
    }

    const result: {
      readonly mttdCompliant: boolean;
      readonly mttrCompliant: boolean;
      readonly actualMttdMinutes?: number;
      readonly actualMttrMinutes?: number;
    } = {
      mttdCompliant,
      mttrCompliant,
      ...(actualMttdMinutes !== undefined ? { actualMttdMinutes } : {}),
      ...(actualMttrMinutes !== undefined ? { actualMttrMinutes } : {}),
    };

    return result;
  },
} as const;

// ---------------------------------------------------------------------------
// Phase 26.5 & 26.6: External Pilot Classification & Feature Gating
// ---------------------------------------------------------------------------

export type PilotClassification =
  "SYNTHETIC" | "INTERNAL" | "EXTERNAL_SANDBOX" | "EXTERNAL_LIMITED" | "PRODUCTION_PILOT";

export type PilotFeatureKey =
  | "payments"
  | "payouts"
  | "email"
  | "push"
  | "saml"
  | "scim"
  | "oneRoster"
  | "lti"
  | "aiAssistant"
  | "rag"
  | "credentials";

export interface PilotRecord {
  readonly pilotId: string;
  readonly institutionId: string;
  readonly pilotType: PilotClassification;
  readonly authorizedBy: string; // Reference/identifier of legal authorization
  readonly approvedScope: readonly string[];
  readonly dataClassification: "CONFIDENTIAL" | "RESTRICTED" | "PUBLIC";
  readonly startAt: string;
  readonly plannedEndAt: string;
  readonly enabledFeatures: readonly PilotFeatureKey[];
  readonly enabledProviders: Record<
    string,
    "SANDBOX_VERIFIED" | "EXTERNAL_PILOT_VERIFIED" | "NOT_CONFIGURED" | "SIMULATION"
  >;
  readonly cohortSize: number;
  readonly supportOwner: string;
  readonly incidentContact: string; // Reference only, e.g. "ref:contacts/polytech-noc"
}

export const PilotFeatureGatingEngine = {
  isFeatureEnabled(pilot: PilotRecord, feature: PilotFeatureKey): boolean {
    return pilot.enabledFeatures.includes(feature);
  },

  assertLivePayoutAllowed(pilot: PilotRecord): boolean {
    // If payout remains SANDBOX_PROVIDER, live payouts are strictly prohibited
    const providerState = pilot.enabledProviders["payout"];
    if (!this.isFeatureEnabled(pilot, "payouts") || providerState !== "EXTERNAL_PILOT_VERIFIED") {
      return false;
    }
    return true;
  },

  assertLivePaymentAllowed(pilot: PilotRecord): boolean {
    const providerState = pilot.enabledProviders["payment"];
    if (!this.isFeatureEnabled(pilot, "payments") || providerState !== "EXTERNAL_PILOT_VERIFIED") {
      return false;
    }
    return true;
  },
} as const;

// ---------------------------------------------------------------------------
// Phase 27.5 & 27.18: Disaggregated Incident Response & Pilot Authorization
// ---------------------------------------------------------------------------

export interface DisaggregatedIncidentMetrics {
  readonly incidentId: string;
  readonly severity: IncidentSeverityLevel;
  readonly title: string;
  // Sub-second automated failover / detection
  readonly automatedDetectionMs: number;
  readonly automatedFailoverMs: number;
  // Human engineering response & root-cause triage
  readonly humanAcknowledgmentMinutes: number; // MTTA (Human)
  readonly humanResolutionMinutes: number; // MTTR (Human)
  readonly totalUnplannedDowntimeSeconds: number;
  readonly dataLossRecords: number;
  readonly automatedFailoverSuccessful: boolean;
}

export interface PilotAuthorizationSignatory {
  readonly role: string;
  readonly organization: string;
  readonly authorizedDate: string;
}

export interface PilotAuthorizationRecord {
  readonly authorizationReference: string;
  readonly authorizationStatus: "EXTERNAL_PILOT_ACTIVE" | "SUSPENDED" | "CONCLUDED";
  readonly pilotId: string;
  readonly institutionReference: string;
  readonly institutionName: string;
  readonly institutionDomain: string;
  readonly legalFramework: string;
  readonly signatories: readonly PilotAuthorizationSignatory[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly approvedDataClassification: "CONFIDENTIAL" | "RESTRICTED" | "PUBLIC";
  readonly deliveryChannel: "RESPONSIVE_WEB" | "HYBRID" | "NATIVE_MOBILE";
  readonly approvedUserCohort: {
    readonly facultyMembers: number;
    readonly studentLearners: number;
    readonly institutionalAdmins: number;
    readonly totalAuthorized: number;
  };
  readonly approvedFeatureScope: readonly string[];
  readonly excludedFeatureScope: readonly string[];
  readonly scopeConstraints: {
    readonly mobilePilotScope: "NOT_IN_SCOPE";
    readonly mobileAccessMethod: string;
    readonly paymentsScope: "SANDBOX_ONLY";
    readonly payoutsScope: "GATED";
    readonly extrapolationRule: "EXTRAPOLATION_PROHIBITED";
  };
  readonly operationalContacts: {
    readonly primaryInstitutionLiaison: string;
    readonly incidentResponseContact: string;
    readonly ailssPlatformSupport: string;
    readonly slaTier: string;
  };
  readonly integrityVerification: {
    readonly technicalAddendumSha256: string;
    readonly verificationMethod: string;
  };
}

export const PilotAuthorizationValidator = {
  validate(record: PilotAuthorizationRecord): {
    readonly valid: boolean;
    readonly errors: readonly string[];
  } {
    const errors: string[] = [];

    if (record.authorizationStatus !== "EXTERNAL_PILOT_ACTIVE") {
      errors.push(`Authorization status is not active: ${record.authorizationStatus}`);
    }

    if (!record.authorizationReference || !record.authorizationReference.startsWith("MOU-")) {
      errors.push(`Invalid authorization reference format: ${record.authorizationReference}`);
    }

    if (record.scopeConstraints.mobilePilotScope !== "NOT_IN_SCOPE") {
      errors.push(
        `Mobile pilot scope must be explicitly 'NOT_IN_SCOPE', got: ${record.scopeConstraints.mobilePilotScope}`,
      );
    }

    if (record.scopeConstraints.paymentsScope !== "SANDBOX_ONLY") {
      errors.push(`Payments scope must be 'SANDBOX_ONLY', got: ${record.scopeConstraints.paymentsScope}`);
    }

    if (record.scopeConstraints.payoutsScope !== "GATED") {
      errors.push(`Payouts scope must be 'GATED', got: ${record.scopeConstraints.payoutsScope}`);
    }

    if (record.signatories.length < 2) {
      errors.push(
        `Bilateral authorization requires at least 2 signatories, got: ${record.signatories.length}`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
} as const;
