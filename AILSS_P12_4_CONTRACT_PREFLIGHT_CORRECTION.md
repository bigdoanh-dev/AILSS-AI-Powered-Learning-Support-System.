# AILSS P12.4 contract consistency preflight correction

Status: applied; P12.4 Lecturer UI work intentionally stopped at the mandatory preflight gate.

## ASM-09

Runtime `AssessmentService.resultSummary` and its router implement an owner-safe Student result response. Real P12.3 acceptance exercised it successfully. The public OpenAPI still exposed an obsolete Phase 7 `501` placeholder and did not bind its existing `AttemptResultResponse` schema.

Correction: remove `501`, bind the `200` response to `AttemptResultResponse`, and document the implemented `400/401/404/409/503` error envelope responses. No runtime behavior or inventory changed.

## INT-08

The API registry said `owner/moderator`, but AILSS has no canonical `MODERATOR` role. `ReviewService.mutate` first requires `STUDENT`, then requires `old.authorId === actor.userId`. Admin moderation is a separate INT-11 operation with canonical `ADMIN` authority.

Correction: change INT-08 registry authority to `owner student`. No role, route or runtime behavior was added.

## Scope

This is the smallest bounded contract correction required by the P12.4 prompt. Counts remain 98 public APIs, 15 internal APIs, 74 Query IDs, 22 event types and 6 business services; Redis remains false. Lecturer UI/session-adapter work did not begin.
