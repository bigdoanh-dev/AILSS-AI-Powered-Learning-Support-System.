# Mobile lint baseline

Baseline for the Phase 41 Revision B no-regression check. The 19 existing errors below are confined to deferred Lecturer/Admin UI and legacy shared files. The guard allows these exact per-file/per-rule counts only; any new error, increased count, or finding in another file fails.

| File                                          | Existing rule counts                      |
| --------------------------------------------- | ----------------------------------------- |
| `app/admin/stats/index.tsx`                   | `no-unused-vars`: 3; `no-explicit-any`: 2 |
| `app/teaching/classes/index.tsx`              | `no-unused-vars`: 3                       |
| `app/teaching/courses/[courseId]/reviews.tsx` | `no-unused-vars`: 2                       |
| `app/teaching/index.tsx`                      | `no-unused-vars`: 1                       |
| `app/teaching/reports/index.tsx`              | `no-unused-vars`: 1                       |
| `app/teaching/schedule.tsx`                   | `no-unused-vars`: 1                       |
| `src/AuthFeedback.tsx`                        | `no-unused-vars`: 3                       |
| `src/learning.ts`                             | `no-explicit-any`: 1                      |
| `src/motion.tsx`                              | `no-useless-escape`: 1                    |
| `tests/i18n.test.ts`                          | `no-unused-vars`: 1                       |

Executable gate: `pnpm --dir apps/mobile lint:phase41` (`scripts/phase41-lint.mjs`).
