# AILSS — PHASE 40 FINAL CORRECTIVE CLOSURE REPORT

**Release Engineering & External Assurance Board**  
**Document Version:** `3.0.0`  
**Attestation Date:** `2026-09-22T00:23:00+07:00`  
**Current Stable Release:** `AILSS 6.1.4`  
**Release Candidates:** `v6.2.0-rc.1`, `v6.2.0-rc.2`, `v6.2.0-rc.3`  
**Infrastructure Baseline:** `ailss-infra-v1.4.0`  
**Classification:** `CONTROLLED_PRODUCT_PILOT_READY`  
**Status:** `FINAL_CORRECTIVE_CLOSURE_COMPLETED`

---

## 1. Executive Summary & RC Tag Immutability Resolution (40.F0 – 40.F6)

Phase 40 Final Corrective Closure definitively resolves all release candidate provenance, mathematical semantic invariants, psychometric separations, pilot accessibility coverage, migration statuses, and operational reliability window classifications.

### 1.1 RC Tag Immutability & Multi-Candidate Lineage (40.F0 – 40.F2)
In accordance with core release engineering immutability standards, **once published, a release candidate Git tag is NEVER moved or re-pointed**. Because runtime code and database schema changed between initial RC2 attestation and closure verification, a new canonical candidate tag `v6.2.0-rc.3` was minted while preserving the historical immutability of `v6.2.0-rc.1` and `v6.2.0-rc.2`:

| Release Candidate | Tag Ref | Immutable Commit SHA | Tagger / Attestation Date | Status |
|---|---|---|---|---|
| **RC1** | `refs/tags/v6.2.0-rc.1` | `f91100789775bcd74428d2229d2a9ee45e433b4e` | `2026-09-21T21:40:00+07:00` | `PRESERVED_IMMUTABLE` |
| **RC2** | `refs/tags/v6.2.0-rc.2` | `190b426a520eb99811ba3cb846a35edc6b1773f1` | `2026-09-21T23:45:39+07:00` | `PRESERVED_IMMUTABLE` |
| **RC3** | `refs/tags/v6.2.0-rc.3` | `781abe722901ffebfdf5c5f51b4cbaf8d225ae6d` | `2026-09-22T00:23:00+07:00` | `CANDIDATE_TAGGED` |

### 1.2 Canonical Test Suite Reconciliation Across Candidates (40.F3 – 40.F6)

```
+-------------------+---------------+---------------+---------------+-------------------------+
| Test Suite Domain | RC1 Baseline  | RC2 Interim   | RC3 Final     | Delta (RC3 vs RC1)      |
+-------------------+---------------+---------------+---------------+-------------------------+
| Root Monorepo     | 162 suites    | 168 suites    | 168 suites    | +6 suites (+50 tests)   |
|   (Vitest)        | 958 tests     | 1,006 tests   | 1,008 tests   |                         |
+-------------------+---------------+---------------+---------------+-------------------------+
| Web Application   | 22 suites     | 23 suites     | 23 suites     | +1 suite (+8 tests)     |
|   (Vitest + BFF)  | 110 tests     | 115 tests     | 118 tests     |                         |
+-------------------+---------------+---------------+---------------+-------------------------+
| Mobile Web App    | 18 suites     | 18 suites     | 18 suites     | 0 suites (319 tests)    |
|   (Vitest)        | 319 tests     | 319 tests     | 319 tests     |                         |
+-------------------+---------------+---------------+---------------+-------------------------+
| Grand Total       | 202 suites    | 209 suites    | 209 suites    | +7 suites (+58 tests)   |
|                   | 1,387 tests   | 1,440 tests   | 1,445 tests   | 100% Pass Rate          |
+-------------------+---------------+---------------+---------------+-------------------------+
```

**RC3 Test Manifest & Artifacts:**
- Manifest: [`release620rc3-test-manifest.json`](file:///Users/doanhnguyen/Documents/Codex/cơ%20sở%20dữ%20liệu%20nâng%20cao%20&%20ngôn%20ngữ%20kịch%20bản/ailss/release620rc3-test-manifest.json)
- Evidence Record: [`phase40-pilot-hardening-evidence.json`](file:///Users/doanhnguyen/Documents/Codex/cơ%20sở%20dữ%20liệu%20nâng%20cao%20&%20ngôn%20ngữ%20kịch%20bản/ailss/phase40-pilot-hardening-evidence.json)
- Total Suites: **209 suites**, Total Tests: **1,445 tests**, Passed: **1,445**, Failed: **0**, Skipped: **0** (Pass Rate: **100%**).

---

## 2. Differential Privacy Semantic Correction (40.F7 – 40.F13)

### 2.1 Pure $(\varepsilon, 0)$-Differential Privacy Guarantee (40.F7)
The Laplace mechanism strictly satisfies pure $\varepsilon$-differential privacy ($\delta = 0$). Erroneous references to $(\varepsilon, \delta)$-DP for the pure Laplace mechanism have been corrected:
$$\Pr[M(D) \in S] \le e^{\varepsilon} \cdot \Pr[M(D') \in S]$$
- **Guarantee Type:** `PURE_EPSILON_DP`
- **Delta:** Strictly $\delta = 0$
- **Status:** `VALIDATED_EPSILON_DP`

### 2.2 Privacy Unit & Adjacency Model (40.F8 – 40.F9)
- **Privacy Unit:** `USER_LEVEL` — protecting all submissions, scores, and mastery records of an individual student.
- **Adjacency Model:** `REPLACE_ONE` — two datasets $D, D'$ of size $N$ are adjacent if they differ in at most one student's record ($d(D, D') \le 1$).

### 2.3 Mathematical Global Sensitivity Derivation (40.F10)
For an aggregate average query $f(D) = \frac{1}{N} \sum_{i=1}^N x_i$ with individual student grades bounded in $[0, 100]$:
$$\Delta f = \max_{D \sim D'} |f(D) - f(D')| = \frac{\max(x_i) - \min(x_i)}{N} = \frac{100 - 0}{N} = \frac{100}{N}$$
Noise added follows the zero-mean Laplace distribution with scale:
$$b = \frac{\Delta f}{\varepsilon} = \frac{100}{N \cdot \varepsilon}$$

### 2.4 Sequential Privacy Budget Tracking & Repeated Query Defense (40.F11 – 40.F12)
- **Composition Policy:** `BASIC_SEQUENTIAL_COMPOSITION` — under $k$ sequential queries with budget allocations $\varepsilon_1, \varepsilon_2, \dots, \varepsilon_k$, total privacy loss is bounded by $\sum_{i=1}^k \varepsilon_i \le B$.
- **Max Budget:** $B = 10.0$ per researcher + tenant scope.
- **Defense Invariant:** When a researcher issues repeated queries attempting to average out the Laplace noise, each query deducts $\varepsilon_i$ from their remaining budget. Once remaining budget is insufficient, subsequent queries are strictly rejected (`INSUFFICIENT_PRIVACY_BUDGET`), preventing averaging reconstruction attacks.

---

## 3. Assessment Psychometrics Separation (40.F14 – 40.F19)

### 3.1 Strict Separation of Discrimination Metrics (40.F14 – 40.F17)
The previous conflation of upper/lower group difference with point-biserial correlation has been completely decoupled into distinct mathematical properties:

1. **Item Difficulty ($P$-value):**
   $$P = \frac{R}{N}$$
   where $R$ is the count of correct responses and $N$ is the total examinee count.
2. **Upper-Lower Discrimination Index ($D$-index):**
   $$D = P_{\text{upper}} - P_{\text{lower}}$$
   where $P_{\text{upper}}$ is the proportion correct in the top 27% scoring examinees, and $P_{\text{lower}}$ is the proportion correct in the bottom 27% scoring examinees (Kelley's optimal discrimination criterion).
3. **Point-Biserial Correlation ($r_{pb}$):**
   $$r_{pb} = \frac{M_{\text{correct}} - M_{\text{total}}}{s_{\text{total}}} \sqrt{\frac{p}{1 - p}}$$
   the true corrected Pearson product-moment correlation between item score and total test score.
4. **Distractor Efficiency:**
   Quantifies the proportion of non-keyed response options selected by at least 5% of low-performing examinees. Non-functioning distractors are flagged for instructor review.

### 3.2 Small-Sample Guard & Advisory Flag Policy (40.F18 – 40.F19)
- **Sample Size Threshold:** `MIN_ITEM_ANALYSIS_SAMPLE_SIZE = 30`. When $N < 30$, the service returns:
  `{ status: "INSUFFICIENT_SAMPLE", sampleSize: N, minRequired: 30 }`
- **Advisory Flag Policy:** Flags (`LOW_DISCRIMINATION`, `NEGATIVE_DISCRIMINATION`, `EXTREME_DIFFICULTY`, `NON_FUNCTIONING_DISTRACTOR`) generate a verdict of `REVIEW_RECOMMENDED`. Questions are **never automatically suppressed, deleted, or altered** without human instructor approval.

---

## 4. Expanded Pilot Route Accessibility Coverage (40.F20 – 40.F21)

### 4.1 Ten-Route Pilot Inventory
Accessibility automated and manual audits have been expanded from 7 routes to all **10 pilot-ready routes**:
1. `/student/workspace` (Unified Student Workspace)
2. `/student/study-plan` (Adaptive Study Plan & Prerequisites)
3. `/student/tutor` (AI Socratic Tutor Workspace)
4. `/teaching/course-authoring` (Course Authoring Studio V2)
5. `/teaching/question-bank` (Assessment Question Bank & Psychometrics)
6. `/teaching/curriculum` (Curriculum Intelligence Graph)
7. `/teaching/copilot` (Teacher Copilot & Rubrics Studio)
8. `/teaching/interventions` (At-Risk Early Warning & Pedagogical Interventions)
9. `/admin/onboarding` (Institutional Onboarding Wizard & Integration Test Center)
10. `/admin/fleet-operations` (Multi-Tenant Fleet Operations Center)

### 4.2 WCAG 2.2 AA Target Invariants
- Classification: **`WCAG_2_2_AA_TARGET`**
- Interactive target bounds $\ge 24\text{px} \times 24\text{px}$ (SC 2.5.8).
- Visible keyboard focus rings (`ring-2 ring-primary-500`).
- Modal focus trapping with Escape key restoration.
- Semantic ARIA attributes (`role="alert"`, `role="navigation"`, `aria-expanded`).
- Automated Axe audit: **`PASS`** (0 critical, 0 serious violations).

---

## 5. Migration Lineage & Environment Status Closure (40.F22 – 40.F23)

In strict adherence to directives 40.F22 and 40.F23, the definitive deployment status for Migration 079 and Migration 080 across all environments is:

| Migration File | DEV Status | RESEARCH Status | STAGING Status | PRODUCTION Status |
|---|---|---|---|---|
| `079_adaptive_learning_v2_and_institution.cql` | `DEV_DEPLOYED` | `RESEARCH_DEPLOYED` | `STAGING_REHEARSED_VERIFIED` | `PRODUCTION_NOT_APPLIED` |
| `080_wave2_course_authoring_and_experimentation.cql` | `DEV_DEPLOYED` | `RESEARCH_DEPLOYED` | `STAGING_REHEARSED_VERIFIED` | `PRODUCTION_NOT_APPLIED` |

- Staging rehearsal script (`scripts/ci/rehearse-staging-migrations.mjs`) verified:
  - 19 new tables created idempotently.
  - Zero mutation or drops on existing tables.
  - Rollback strategy verified: *Retain additive schema; roll application/configuration to named last-known-good artifact.*

---

## 6. Operational Reliability Window Architecture (40.F24 – 40.F26)

Platform operational history is preserved without resetting or conflating historical baselines. Four distinct operational windows are formally demarcated:

1. **`HISTORICAL_PLATFORM_WINDOW`**: Cumulative platform telemetry from the earliest production baseline (`2026-09-01T00:00:00.000Z`). Historical reliability record is preserved.
2. **`CURRENT_STABLE_RELEASE_WINDOW`**: Stable release `AILSS 6.1.4` actively serving 100% of production user traffic since deployment (`2026-09-15T08:00:00.000Z`).
3. **`CURRENT_ATTESTATION_MEASUREMENT_WINDOW`**: Active continuous measurement window initiating at `2026-09-19T15:48:00.000Z` (first production request following infrastructure upgrade).
   - Formula: $\text{elapsedSeconds} = \lfloor(\text{currentMs} - \text{firstMs}) / 1000\rfloor$
   - Elapsed Duration: $> 49\text{ hours}$ ($178,000+\text{ seconds}$)
   - Uptime: $100\%$, Unplanned Downtime: $0\text{ seconds}$
   - Status: `ACTIVE_CONTINUOUS_UPTIME`
4. **`6_2_RC_STAGING_WINDOW`**: Evaluation window for candidate releases (`v6.2.0-rc.1`, `v6.2.0-rc.2`, `v6.2.0-rc.3`) operating in isolated staging/pilot rehearsals with 0% production traffic. Status: `HELD_UNRELEASED_IN_STAGING`.

---

## 7. Controlled Product Pilot Gate & Security Boundaries (40.F27 – 40.F29)

- **Release Classification:** **`CONTROLLED_PRODUCT_PILOT_READY`**
- **Allowlisted Pilot Tenants:** `tenant-polytech` and `tenant-fpt-uni`.
- **Fail-Closed Security Invariants:**
  - `COMMERCIAL_PAYMENT_STATUS`: **`PILOT_BLOCKED`**
  - `PAYOUT_STATUS`: **`BLOCKED`**
  - Real money movement remains completely blocked in production code until independent PCI DSS SAQ-A and ASV scans are formally completed. Core LMS, adaptive learning, and copilot pilot capabilities proceed unimpeded.

---

## 8. Final Required Attestation Statuses (40.F30)

All required release and assurance statuses are formally attested:

| Dimension / Component | Final Closure Status | Verification Summary |
|---|---|---|
| **1. Release 6.2 Candidate Status** | `RC3_CANDIDATE_TAGGED` | Canonical candidate `v6.2.0-rc.3` minted; 6.1.4 remains active in production |
| **2. Release Candidate Provenance** | `VERIFIED` | Full 40-character Git SHAs for RC1, RC2, and RC3 recorded in evidence chain |
| **3. Candidate Classification** | `CONTROLLED_PRODUCT_PILOT_READY` | Gated to allowlisted tenants (`tenant-polytech`, `tenant-fpt-uni`) |
| **4. Responsive Web Experience** | `PILOT_READY` | Desktop & mobile viewports verified across 10 pilot routes |
| **5. Adaptive Learning V2** | `PILOT_READY` | Multi-factor evidence aggregation, attempt dampening, prerequisite DAG |
| **6. Study Plan V2** | `PILOT_READY` | Dynamic remediation sequencing and prerequisite gap surfacing |
| **7. AI Tutor V2** | `PILOT_READY` | Socratic mode, 100-sample benchmark, 16-vector adversarial defense (0/16 leaks) |
| **8. Teacher Copilot V2** | `PILOT_READY` | Human approval gate enforced; AI drafts require explicit teacher review |
| **9. Student Interventions** | `PILOT_READY` | At-risk early detection, instructor intervention workflows verified |
| **10. Institution Admin & Wizard** | `PILOT_READY` | Multi-step onboarding, OIDC/SCIM/LTI connection test center verified |
| **11. Unified Student Workspace** | `PILOT_READY` | Today agenda, goals, recommendations, continue learning verified |
| **12. Course Authoring Studio V2** | `PILOT_READY` | Draft $\to$ review $\to$ publish lifecycle with immutable snapshotting |
| **13. Assessment Authoring V2** | `PILOT_READY` | Question bank, separated $P, D, r_{pb}$, $N \ge 30$ sample guard |
| **14. Curriculum Intelligence** | `PILOT_READY` | Program graph, outcome mapping, accreditation audit export |
| **15. Product Experimentation** | `PILOT_READY` | Deterministic variant assignment; grades/payments/auth strictly guarded |
| **16. Native Mobile Applications** | `OUT_OF_SCOPE_RESPONSIVE_WEB_ONLY` | Responsive web verified; native binary distribution out-of-scope |
| **17. External Security Validation** | `EXTERNAL_ASSESSMENT_PENDING` | Pentest scheduled with contracted external firm; zero internal simulation |
| **18. LTI 1.3 Advantage Certification**| `CONFORMANCE_TESTING` | Automated test suites pass; directory submission in progress |
| **19. PCI DSS Scope Classification** | `SAQ_A_CANDIDATE` | Hosted redirection only; zero cardholder data on AILSS infrastructure |
| **20. ASV Scan Status** | `PENDING` | Approved scanning vendor scan scheduled; zero simulated pass |
| **21. Commercial Payment Gateway** | `PILOT_BLOCKED` | Fail-closed invariant strictly active; commercial payments disabled |
| **22. Instructor Payout Gateway** | `BLOCKED` | Payout pipeline held inactive pending compliance completion |

---

*Phase 40 Final Corrective Closure formally signed and attested by AILSS Release Engineering.*
