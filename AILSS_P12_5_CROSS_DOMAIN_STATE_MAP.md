# AILSS P12.5 — Cross-domain product state map

This is a frontend coordination map. Each box remains owned by its current backend service; the Web does not persist a combined state.

```text
Course (Learning: DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED)
  ├─ Lesson (Learning: DRAFT | INCOMPLETE | READY)
  ├─ Offering (Learning: DRAFT → PUBLISHED → CLOSED)
  │    ├─ SELF_PACED → entitlement/enrollment under Learning rules
  │    └─ LIVE_COHORT → an existing compatible Class with published schedule
  ├─ Class.linkedCourseId (Classroom, when returned)
  │    ├─ Membership (PENDING | ACTIVE)
  │    ├─ ClassSession (DRAFT → SCHEDULED | CANCELLED | COMPLETED)
  │    ├─ Schedule (DRAFT → PUBLISHED, then immutable)
  │    ├─ Announcement
  │    └─ Attendance (NOT_RECORDED | PRESENT | ABSENT | EXCUSED)
  └─ Quiz target COURSE or CLASS (Assessment: DRAFT → PUBLISHED → CLOSED | ARCHIVED)
```

The Lecturer UI may coordinate these resources only through identifiers returned by authoritative projections: `Offering.courseId`, optional `Offering.classId`, optional `Class.linkedCourseId`, and quiz target identifiers. It must not infer ownership from the public catalog.

## Product guidance derived from canonical data

- A DRAFT Course guides the Lecturer to add READY lessons and submit review. Only Admin publication APIs publish or archive a Course.
- A published Course without an Offering is content that is ready but has no registration window. A DRAFT Offering is not open. A PUBLISHED Offering is open only under its returned time window and type rules.
- LIVE_COHORT requires a real Class. Publishing it also requires an ACTIVE Class with a PUBLISHED schedule; Web does not auto-create either.
- Class membership is independent from Course enrollment. Classroom is the sole roster authority.
- Students receive session visibility, announcements, meeting details, and attendance only through membership-authorized Classroom reads.
- Free LRN-14 enrollment still depends on the legacy deterministic default Offering. Normal Course authoring does not create that Offering; Web retains actionable `OFFERING_NOT_AVAILABLE` copy.
- There is no authoritative owned-course index. Recent navigation may be session-local and clearly labelled, while owned Offerings and Classes may cross-link to a Course using their returned identifiers.
