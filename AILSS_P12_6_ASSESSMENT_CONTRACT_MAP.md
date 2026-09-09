# AILSS P12.6 Assessment contract map

| ID     | Public operation                               | Role and UI consequence                                                                                                            |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ASM-01 | `POST /quizzes`                                | Verified Lecturer; idempotent; creates an owned `DRAFT` quiz.                                                                      |
| ASM-02 | `GET /quizzes/{quizId}`                        | Eligible Student gets questions without `correctAnswer`; owner Lecturer gets authoring answers.                                    |
| ASM-03 | `PATCH /quizzes/{quizId}`                      | Owner Lecturer; idempotent; `DRAFT` only; server returns the immutable canonical version.                                          |
| ASM-04 | `POST /quizzes/{quizId}/publish`               | Owner Lecturer; idempotent; explicit `DRAFT → PUBLISHED`. Saving never publishes.                                                  |
| ASM-05 | `GET /targets/{targetType}/{targetId}/quizzes` | Eligible, target-scoped discovery. There is no global quiz index.                                                                  |
| ASM-06 | `POST /quizzes/{quizId}/attempts`              | Student explicit start/resume; idempotent; returns the pinned question snapshot.                                                   |
| ASM-07 | `GET /attempts/{attemptId}`                    | Student owner metadata only. It does not contain pinned questions.                                                                 |
| ASM-08 | `POST /attempts/{attemptId}/submit`            | Student owner; idempotent; exact `answers[]` plus frozen `clientSubmittedAt`.                                                      |
| ASM-09 | `GET /attempts/{attemptId}/result`             | Implemented Student owner-safe result read; score summary only.                                                                    |
| ASM-10 | `GET /quizzes/{quizId}/results`                | Owner Lecturer; bounded by `month`, `limit`, opaque `cursor`. Runtime merges 16 internal shards; there is no public `shard` input. |
| AI-05  | approve reviewed AI draft                      | Requires `If-Match: "v1"`; creates Assessment Quiz v1 in `DRAFT`. It does not publish the quiz.                                    |

Canonical quiz states are `DRAFT`, `PUBLISHED`, `CLOSED`, `ARCHIVED`. Canonical attempt states are `CREATED`, `IN_PROGRESS`, `SUBMITTED`, `EXPIRED`.
