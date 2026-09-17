export const PILOT_INSTITUTION_ID = "tenant-pilot-polytech";

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

