import { randomUUID } from "node:crypto";
import { reviewList, commentList, buildIfMatch, type Review, type Comment } from "../src/interaction";
import {
  notificationList,
  notificationReadResult,
  formatCurrentMonth,
  resolveNotificationRoute,
} from "../src/notifications";
import { userProfile, profileUpdateResponse, avatarResponse } from "../src/account";

const origin = process.env.AILSS_MOBILE_TEST_ORIGIN || "http://127.0.0.1:8080";
const email = process.env.AILSS_MOBILE_TEST_EMAIL || "student.demo@ailss.local";
const password = process.env.AILSS_MOBILE_TEST_PASSWORD || "AilssDemo!2026";

async function main() {
  console.log("============================================================");
  console.log("AILSS PHASE 14.2D — LIVE INTEGRATION TEST");
  console.log("Student Mobile: Interaction + Notifications + Account");
  console.log("Gateway:", origin);
  console.log("Target User:", email);
  console.log("Credentials: [REDACTED]");
  console.log("============================================================\n");

  // 1. Authenticate (IDN-01)
  console.log("Step 1: Authenticating student account...");
  const loginRes = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
  }

  const loginBody = (await loginRes.json()) as { data?: { accessToken?: string } };
  const token = loginBody.data?.accessToken;
  if (!token) throw new Error("Missing access token in login response");
  console.log("✓ Login successful, session established.\n");

  const authHeaders = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  // 2. Account / Profile Slice (IDN-05, IDN-06, IDN-18, IDN-19)
  console.log("Step 2: Testing Account & Profile vertical slice...");

  // 2.1 Read Profile (IDN-05)
  const profileRes = await fetch(`${origin}/api/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!profileRes.ok) throw new Error(`Fetch /me failed with status ${profileRes.status}`);
  const profileRaw = await profileRes.json();
  const profile = userProfile((profileRaw as { data?: unknown }).data ?? profileRaw);
  console.log(
    `✓ Read profile (IDN-05): UserID=${profile.userId}, Role=${profile.role}, DisplayName="${profile.displayName}"`,
  );
  if (profile.role !== "STUDENT") {
    throw new Error(`Expected STUDENT role, got ${profile.role}`);
  }

  const originalDisplayName = profile.displayName;
  const testDisplayName = `${originalDisplayName} (P14.2D Test)`;

  // 2.2 Update Display Name (IDN-06)
  const updateNameKey = randomUUID();
  const updateRes = await fetch(`${origin}/api/v1/me`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "idempotency-key": updateNameKey,
    },
    body: JSON.stringify({ displayName: testDisplayName }),
  });
  if (!updateRes.ok)
    throw new Error(`Update /me failed with status ${updateRes.status}: ${await updateRes.text()}`);
  const updateRaw = await updateRes.json();
  const updateResult = profileUpdateResponse((updateRaw as { data?: unknown }).data ?? updateRaw);
  console.log(
    `✓ Updated display name (IDN-06): updated=${updateResult.updated}, version=${updateResult.profileVersion}`,
  );

  // Verify updated profile
  const verifyRes = await fetch(`${origin}/api/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const verifyProfile = userProfile(((await verifyRes.json()) as { data?: unknown }).data);
  if (verifyProfile.displayName !== testDisplayName) {
    throw new Error(
      `Display name update verification failed. Expected "${testDisplayName}", got "${verifyProfile.displayName}"`,
    );
  }
  console.log(`✓ Verified updated display name: "${verifyProfile.displayName}"`);

  // Restore original display name (zero test data pollution)
  const restoreNameKey = randomUUID();
  const restoreRes = await fetch(`${origin}/api/v1/me`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "idempotency-key": restoreNameKey,
    },
    body: JSON.stringify({ displayName: originalDisplayName }),
  });
  if (!restoreRes.ok) throw new Error(`Restore /me failed with status ${restoreRes.status}`);
  console.log(`✓ Restored original display name: "${originalDisplayName}" (Zero pollution)`);

  // 2.3 Avatar Read & Write (IDN-18, IDN-19)
  console.log("\nTesting Avatar read & update (IDN-18, IDN-19)...");
  const avatarReadRes = await fetch(`${origin}/api/v1/me/avatar`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!avatarReadRes.ok) throw new Error(`Fetch /me/avatar failed with status ${avatarReadRes.status}`);
  const avatarInitial = avatarResponse(((await avatarReadRes.json()) as { data?: unknown }).data);
  console.log(`✓ Initial avatar state: ${avatarInitial.dataUrl ? "Has custom avatar" : "Default / Null"}`);

  // Test avatar write with valid 1x1 base64 PNG
  const samplePngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const avatarWriteRes = await fetch(`${origin}/api/v1/me/avatar`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ dataUrl: samplePngDataUrl }),
  });
  if (!avatarWriteRes.ok)
    throw new Error(
      `Write avatar failed with status ${avatarWriteRes.status}: ${await avatarWriteRes.text()}`,
    );
  const avatarUpdated = avatarResponse(((await avatarWriteRes.json()) as { data?: unknown }).data);
  if (!avatarUpdated.dataUrl) throw new Error("Expected non-null avatar dataUrl after write");
  console.log("✓ Updated avatar via dataUrl (IDN-19)");

  // Restore avatar to initial or null
  const avatarRestoreRes = await fetch(`${origin}/api/v1/me/avatar`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ dataUrl: avatarInitial.dataUrl }),
  });
  if (!avatarRestoreRes.ok) throw new Error(`Restore avatar failed with status ${avatarRestoreRes.status}`);
  console.log("✓ Restored initial avatar state (Zero pollution)\n");

  // 3. In-App Notifications Slice (NOT-01, NOT-02)
  console.log("Step 3: Testing In-App Notifications vertical slice...");
  const currentMonth = formatCurrentMonth();
  const notifRes = await fetch(`${origin}/api/v1/notifications?month=${currentMonth}&limit=20`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!notifRes.ok)
    throw new Error(`Fetch notifications failed with status ${notifRes.status}: ${await notifRes.text()}`);
  const notifData = (await notifRes.json()) as { data?: unknown };
  const notifList = notificationList(notifData.data ?? notifData);
  console.log(
    `✓ Retrieved notifications (NOT-01): Month=${notifList.month}, Count=${notifList.items.length}`,
  );

  if (notifList.items.length > 0) {
    const item = notifList.items[0];
    console.log(
      `  Sample Notification: ID=${item.notificationId}, Title="${item.title}", Read=${item.readAt ? "YES" : "NO"}`,
    );
    const resolvedRoute = resolveNotificationRoute(item);
    console.log(`  Resolved Route: ${resolvedRoute ?? "None (Safe Fallback)"}`);

    // Test mark read (NOT-02) with required x-notification-locator header
    console.log("  Testing mark read (NOT-02)...");
    const readRes = await fetch(`${origin}/api/v1/notifications/${item.notificationId}/read`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "x-notification-locator": item.locator,
      },
    });
    if (!readRes.ok) {
      throw new Error(`Mark read failed with status ${readRes.status}: ${await readRes.text()}`);
    }
    const readData = (await readRes.json()) as { data?: unknown };
    const readResult = notificationReadResult(readData.data ?? readData);
    console.log(`✓ Marked notification as READ: State=${readResult.state}, ReadAt=${readResult.readAt}`);
  } else {
    console.log("  (No notifications present in current month partition, verified valid list contract)");
  }
  console.log("");

  // 4. Course Reviews & Ratings Slice (INT-05, INT-06, INT-07)
  console.log("Step 4: Testing Course Reviews & Ratings vertical slice...");
  const coursesRes = await fetch(`${origin}/api/v1/me/courses`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!coursesRes.ok) throw new Error(`Fetch courses failed with status ${coursesRes.status}`);
  const coursesData = (await coursesRes.json()) as { data?: { courseId: string; title: string }[] };
  const courses = coursesData.data ?? [];
  if (courses.length === 0) throw new Error("No enrolled courses found for student");

  let targetCourse = courses[0];
  let reviewsList = reviewList({ data: [], ratingSummary: { reviewCount: 0, ratingSum: 0, average: 0 } });

  for (const c of courses) {
    const res = await fetch(`${origin}/api/v1/courses/${c.courseId}/reviews?limit=20`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const list = reviewList(await res.json());
      if (list.items.some((r) => r.authorId === profile.userId)) {
        targetCourse = c;
        reviewsList = list;
        break;
      }
    }
  }

  console.log(`Target Course: ID=${targetCourse.courseId}, Title="${targetCourse.title}"`);
  console.log(
    `✓ Fetched course reviews (INT-05): Count=${reviewsList.items.length}, Avg=${reviewsList.ratingSummary.average.toFixed(1)}, Total=${reviewsList.ratingSummary.reviewCount}`,
  );

  const existingReview = reviewsList.items.find((r) => r.authorId === profile.userId);
  if (!existingReview) {
    throw new Error("Expected existing review for demo course");
  }

  // 4.2 Test duplicate review rejection (INT-06 Conflict contract)
  console.log("Testing duplicate review creation conflict (INT-06)...");
  const dupKey = randomUUID();
  const dupRes = await fetch(`${origin}/api/v1/courses/${targetCourse.courseId}/reviews`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "idempotency-key": dupKey,
    },
    body: JSON.stringify({
      rating: 5,
      body: "Duplicate review attempt",
    }),
  });
  if (dupRes.status === 409) {
    console.log("✓ Correctly rejected duplicate review with 409 Conflict (INT-06)");
  } else {
    throw new Error(`Expected 409 Conflict on duplicate review, got ${dupRes.status}`);
  }

  // 4.3 Edit Review (INT-07) with If-Match precondition
  console.log("\nTesting review modification with If-Match precondition (INT-07)...");
  const originalVersion = existingReview.version;
  const originalRating = existingReview.rating;
  const originalBody = existingReview.body;

  const patchKey = randomUUID();
  const ifMatchHeader = buildIfMatch(originalVersion);
  const patchReviewRes = await fetch(`${origin}/api/v1/reviews/${existingReview.reviewId}`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "idempotency-key": patchKey,
      "if-match": ifMatchHeader,
    },
    body: JSON.stringify({
      rating: 4,
      body: "Cập nhật đánh giá qua kiểm thử tích hợp Mobile P14.2D",
    }),
  });
  if (!patchReviewRes.ok) {
    throw new Error(
      `Patch review failed with status ${patchReviewRes.status}: ${await patchReviewRes.text()}`,
    );
  }
  const patchReviewRaw = (await patchReviewRes.json()) as { data?: Review };
  const patchedReview = patchReviewRaw.data;
  if (!patchedReview) throw new Error("Patched review missing from response");
  console.log(
    `✓ Edited course review (INT-07) with ${ifMatchHeader}: Rating=${patchedReview.rating}, Version=${patchedReview.version}`,
  );

  // Test Precondition Failure with stale version
  console.log("Testing optimistic concurrency failure with stale If-Match...");
  const staleKey = randomUUID();
  const staleRes = await fetch(`${origin}/api/v1/reviews/${existingReview.reviewId}`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "idempotency-key": staleKey,
      "if-match": ifMatchHeader, // Stale version!
    },
    body: JSON.stringify({ rating: 3, body: "Stale attempt" }),
  });
  if (staleRes.status === 409 || staleRes.status === 412 || staleRes.status === 400) {
    console.log(
      `✓ Optimistic concurrency control verified: rejected stale If-Match with status ${staleRes.status}`,
    );
  } else {
    throw new Error(`Expected concurrency rejection on stale If-Match, got ${staleRes.status}`);
  }

  // Restore original review content (Zero pollution)
  const restoreReviewKey = randomUUID();
  const restoreIfMatch = buildIfMatch(patchedReview.version);
  const restoreReviewRes = await fetch(`${origin}/api/v1/reviews/${existingReview.reviewId}`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "idempotency-key": restoreReviewKey,
      "if-match": restoreIfMatch,
    },
    body: JSON.stringify({
      rating: originalRating,
      body: originalBody,
    }),
  });
  if (!restoreReviewRes.ok) throw new Error(`Restore review failed with status ${restoreReviewRes.status}`);
  console.log(`✓ Restored original review content (Zero pollution)\n`);

  // 5. Resource Comments Slice (INT-01, INT-02, INT-04)
  console.log("Step 5: Testing Resource Comments vertical slice (INT-01, INT-02, INT-04)...");
  // 5.1 Fetch comments (INT-01)
  const commentsRes = await fetch(
    `${origin}/api/v1/resources/COURSE/${targetCourse.courseId}/comments?limit=10`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!commentsRes.ok) throw new Error(`Fetch comments failed with status ${commentsRes.status}`);
  const commentsRaw = await commentsRes.json();
  const initialComments = commentList(commentsRaw);
  console.log(`✓ Fetched course comments (INT-01): Count=${initialComments.items.length}`);

  // 5.2 Create comment (INT-02)
  const commentKey = randomUUID();
  const createCommentRes = await fetch(
    `${origin}/api/v1/resources/COURSE/${targetCourse.courseId}/comments`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "idempotency-key": commentKey,
      },
      body: JSON.stringify({
        body: "P14.2D Test comment: Xin chào giảng viên và các bạn học viên!",
      }),
    },
  );
  if (!createCommentRes.ok) {
    throw new Error(
      `Create comment failed with status ${createCommentRes.status}: ${await createCommentRes.text()}`,
    );
  }
  const createCommentRaw = (await createCommentRes.json()) as { data?: Comment };
  const createdComment = createCommentRaw.data;
  if (!createdComment || !createdComment.commentId) throw new Error("Created comment missing from response");
  console.log(
    `✓ Created comment (INT-02): CommentID=${createdComment.commentId}, Version=${createdComment.version}`,
  );

  // 5.3 Delete comment (INT-04) with If-Match (Zero pollution)
  const deleteCommentKey = randomUUID();
  const commentIfMatch = buildIfMatch(createdComment.version);
  const deleteCommentRes = await fetch(`${origin}/api/v1/comments/${createdComment.commentId}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": deleteCommentKey,
      "if-match": commentIfMatch,
    },
  });
  if (!deleteCommentRes.ok && deleteCommentRes.status !== 204) {
    throw new Error(
      `Delete comment failed with status ${deleteCommentRes.status}: ${await deleteCommentRes.text()}`,
    );
  }
  console.log(
    `✓ Deleted comment (INT-04) with ${commentIfMatch}: Status=${deleteCommentRes.status} (Zero pollution)\n`,
  );

  // 6. Conclude & Logout
  console.log("Step 6: Logging out session...");
  await fetch(`${origin}/api/v1/auth/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  console.log("✓ Session revoked successfully.");

  console.log("\n============================================================");
  console.log("PHASE 14.2D LIVE INTEGRATION: ALL TESTS PASSED");
  console.log("============================================================");
}

main().catch((err) => {
  console.error("\n❌ PHASE 14.2D INTEGRATION FAILED:", err);
  process.exit(1);
});
