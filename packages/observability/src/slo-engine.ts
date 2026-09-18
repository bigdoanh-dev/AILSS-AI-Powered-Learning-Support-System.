/**
 * AILSS SRE Canonical SLO & Error Budget Calculation Engine
 * 
 * Implements standard Google SRE error-budget mathematics:
 * 
 * allowedBadFraction = 1 - targetSLO
 * observedBadFraction = 1 - observedSLI
 * budgetConsumedFraction = observedBadFraction / allowedBadFraction
 * budgetRemainingFraction = max(0, 1 - budgetConsumedFraction)
 * burnRate = observedBadFraction / allowedBadFraction
 */

export interface SloDefinition {
  readonly domain: string;
  readonly targetSlo: number; // e.g. 0.9995 for 99.95%
  readonly windowDays: number; // e.g. 30
  readonly description: string;
  readonly goodEventCriteria: string;
  readonly badEventCriteria: string;
  readonly excludedEventCriteria: string;
}

export interface SloEvaluationInput {
  readonly goodEvents: number;
  readonly badEvents: number;
  readonly excludedEvents?: number;
}

export interface SloEvaluationResult {
  readonly domain: string;
  readonly targetSlo: number;
  readonly targetSloPercent: string;
  readonly observedSli: number;
  readonly observedSliPercent: string;
  readonly totalEvents: number;
  readonly goodEvents: number;
  readonly badEvents: number;
  readonly excludedEvents: number;
  readonly allowedBadEvents: number;
  readonly budgetConsumedPercent: string;
  readonly budgetRemainingPercent: string;
  readonly budgetConsumedFraction: number;
  readonly budgetRemainingFraction: number;
  readonly burnRate: number;
  readonly isBreached: boolean;
  readonly alertSeverity: "NORMAL" | "WARNING_BURNING" | "CRITICAL_EXHAUSTED";
}

export const CANONICAL_PRODUCTION_SLOS: Record<string, SloDefinition> = {
  AUTH_AND_SECURITY: {
    domain: "AUTH_AND_SECURITY",
    targetSlo: 0.9999, // 99.99%
    windowDays: 30,
    description: "SAML SSO, OIDC login, token validation, and session termination availability",
    goodEventCriteria: "HTTP 2xx/3xx on auth routes with latency < 500ms and valid token issued",
    badEventCriteria: "HTTP 5xx, unhandled auth crashes, timeout > 1000ms",
    excludedEventCriteria: "HTTP 401/403 due to invalid client credentials or bad password",
  },
  CORE_LEARNING_APIS: {
    domain: "CORE_LEARNING_APIS",
    targetSlo: 0.9995, // 99.95%
    windowDays: 30,
    description: "Course browsing, lesson loading, content streaming, student progress tracking",
    goodEventCriteria: "HTTP 2xx on learning routes with latency < 1000ms",
    badEventCriteria: "HTTP 5xx, gateway timeout > 2000ms, database read failures",
    excludedEventCriteria: "Client aborts, malformed client queries (400)",
  },
  LTI_AND_WEBHOOKS: {
    domain: "LTI_AND_WEBHOOKS",
    targetSlo: 0.9990, // 99.90%
    windowDays: 30,
    description: "LTI 1.3 launches, Assignment and Grade Services, Names & Role sync",
    goodEventCriteria: "LTI launch succeeds, grades posted to LMS within 5000ms or outbox queued",
    badEventCriteria: "LTI launch 5xx, unhandled signature error, grade dropped without outbox record",
    excludedEventCriteria: "LMS endpoint unreachable returning 502/503 from external LMS server",
  },
  AI_STUDY_ASSISTANT: {
    domain: "AI_STUDY_ASSISTANT",
    targetSlo: 0.9900, // 99.00%
    windowDays: 30,
    description: "AI conversational tutoring, lesson explanation, RAG document search",
    goodEventCriteria: "Streaming response started within 2000ms, grounded non-hallucinated response",
    badEventCriteria: "HTTP 500, unhandled timeout > 10000ms, circuit breaker fallback exhausted",
    excludedEventCriteria: "Client side disconnect, quota-limit 429 when tenant budget is exhausted",
  },
  BATCH_AND_OUTBOX_WORKERS: {
    domain: "BATCH_AND_OUTBOX_WORKERS",
    targetSlo: 0.9990, // 99.90%
    windowDays: 30,
    description: "Transactional outbox event delivery to RabbitMQ, audit trail persistence",
    goodEventCriteria: "Message acknowledged by broker within retry limit",
    badEventCriteria: "Message routed to Dead Letter Queue (DLQ) after terminal retries",
    excludedEventCriteria: "Purposely discarded test probe messages",
  },
  DATA_RECONCILIATION: {
    domain: "DATA_RECONCILIATION",
    targetSlo: 0.9950, // 99.50%
    windowDays: 30,
    description: "SCIM directory synchronization and OneRoster SIS drift reconciliation jobs",
    goodEventCriteria: "Scheduled reconciliation batch completes successfully without corruption",
    badEventCriteria: "Reconciliation process unhandled exception, aborted sync run",
    excludedEventCriteria: "Upstream SIS API maintenance window (scheduled downtime)",
  },
};

/**
 * Calculates error budget metrics from target SLO and observed SLI fractions.
 * 
 * Canonical formula:
 * allowedBad = 1 - targetSLO
 * observedBad = 1 - observedSLI
 * budgetConsumed = observedBad / allowedBad
 * budgetRemaining = max(0, 1 - budgetConsumed)
 */
export function calculateErrorBudget(
  targetSloFraction: number,
  observedSliFraction: number,
): {
  readonly allowedBadFraction: number;
  readonly observedBadFraction: number;
  readonly budgetConsumedFraction: number;
  readonly budgetRemainingFraction: number;
  readonly burnRate: number;
} {
  if (targetSloFraction <= 0 || targetSloFraction >= 1) {
    throw new Error(`Invalid target SLO fraction: ${String(targetSloFraction)}. Must be between 0 and 1.`);
  }

  const allowedBadFraction = 1 - targetSloFraction;
  const observedBadFraction = Math.max(0, 1 - observedSliFraction);

  const budgetConsumedFraction = observedBadFraction / allowedBadFraction;
  const budgetRemainingFraction = Math.max(0, 1 - budgetConsumedFraction);
  const burnRate = budgetConsumedFraction; // Over the measurement window

  return {
    allowedBadFraction,
    observedBadFraction,
    budgetConsumedFraction,
    budgetRemainingFraction,
    burnRate,
  };
}

/**
 * Evaluates an SLO from discrete event counts (goodEvents, badEvents).
 */
export function evaluateSloFromEvents(
  slo: SloDefinition,
  input: SloEvaluationInput,
): SloEvaluationResult {
  const totalEvents = input.goodEvents + input.badEvents;
  const excludedEvents = input.excludedEvents ?? 0;

  if (totalEvents === 0) {
    return {
      domain: slo.domain,
      targetSlo: slo.targetSlo,
      targetSloPercent: `${(slo.targetSlo * 100).toFixed(2)}%`,
      observedSli: 1.0,
      observedSliPercent: "100.00%",
      totalEvents: 0,
      goodEvents: 0,
      badEvents: 0,
      excludedEvents,
      allowedBadEvents: 0,
      budgetConsumedPercent: "0.00%",
      budgetRemainingPercent: "100.00%",
      budgetConsumedFraction: 0,
      budgetRemainingFraction: 1.0,
      burnRate: 0,
      isBreached: false,
      alertSeverity: "NORMAL",
    };
  }

  const observedSli = input.goodEvents / totalEvents;
  const {
    budgetConsumedFraction,
    budgetRemainingFraction,
    burnRate,
  } = calculateErrorBudget(slo.targetSlo, observedSli);

  const allowedBadEvents = Math.floor(totalEvents * (1 - slo.targetSlo));
  const isBreached = observedSli < slo.targetSlo;

  let alertSeverity: "NORMAL" | "WARNING_BURNING" | "CRITICAL_EXHAUSTED" = "NORMAL";
  if (budgetRemainingFraction <= 0) {
    alertSeverity = "CRITICAL_EXHAUSTED";
  } else if (burnRate > 2.0 || budgetRemainingFraction < 0.2) {
    alertSeverity = "WARNING_BURNING";
  }

  return {
    domain: slo.domain,
    targetSlo: slo.targetSlo,
    targetSloPercent: `${(slo.targetSlo * 100).toFixed(2)}%`,
    observedSli,
    observedSliPercent: `${(observedSli * 100).toFixed(2)}%`,
    totalEvents,
    goodEvents: input.goodEvents,
    badEvents: input.badEvents,
    excludedEvents,
    allowedBadEvents,
    budgetConsumedPercent: `${(budgetConsumedFraction * 100).toFixed(2)}%`,
    budgetRemainingPercent: `${(budgetRemainingFraction * 100).toFixed(2)}%`,
    budgetConsumedFraction,
    budgetRemainingFraction,
    burnRate,
    isBreached,
    alertSeverity,
  };
}

/**
 * Calculates multi-window burn rates according to Google SRE alerting standards:
 * - 1 hour window: consumes 2% of 30-day budget -> burn rate = 14.4 (Page alert)
 * - 6 hours window: consumes 5% of 30-day budget -> burn rate = 6.0 (Page alert)
 * - 3 days window: consumes 10% of 30-day budget -> burn rate = 1.0 (Ticket alert)
 */
export function calculateWindowBurnRate(options: {
  readonly targetSlo: number;
  readonly windowHours: number;
  readonly totalWindowEvents: number;
  readonly badWindowEvents: number;
}): {
  readonly burnRate: number;
  readonly budgetConsumedInWindow: number;
  readonly requiresPageAlert: boolean;
  readonly requiresTicketAlert: boolean;
} {
  const allowedBadRatio = 1 - options.targetSlo;
  if (options.totalWindowEvents === 0 || allowedBadRatio === 0) {
    return {
      burnRate: 0,
      budgetConsumedInWindow: 0,
      requiresPageAlert: false,
      requiresTicketAlert: false,
    };
  }

  const observedBadRatio = options.badWindowEvents / options.totalWindowEvents;
  const burnRate = observedBadRatio / allowedBadRatio;
  
  // Fraction of 30-day budget consumed in this window
  const windowTo30DayRatio = options.windowHours / (30 * 24);
  const budgetConsumedInWindow = burnRate * windowTo30DayRatio;

  const requiresPageAlert = (options.windowHours <= 1 && burnRate >= 14.4) ||
                            (options.windowHours <= 6 && burnRate >= 6.0);
  const requiresTicketAlert = options.windowHours <= 72 && burnRate >= 1.0;

  return {
    burnRate,
    budgetConsumedInWindow,
    requiresPageAlert,
    requiresTicketAlert,
  };
}
