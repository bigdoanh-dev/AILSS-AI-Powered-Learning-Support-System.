import { useUiText } from "../../src/use-language";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { ApiError } from "../../src/api";
import { runtime } from "../../src/runtime";
import { lecturerLessons, lecturerCourses, type LecturerLesson } from "../../src/teaching";
import {
  MEDIA_STATUS_COPY,
  clearPendingMediaUpload,
  loadPendingMediaUpload,
  mediaUploadAsset,
  mediaUploadError,
  refreshMediaAsset,
  savePendingMediaUpload,
  uploadLessonVideo,
  type MobileMediaAsset,
  type PendingMediaUpload,
  type UploadableVideo,
} from "../../src/media-upload";
import { Button, Page, ScreenHeader, styles, tokens } from "../../src/ui";

interface TeachingCourse {
  courseId: string;
  title: string;
}

interface UploadAttempt {
  idempotencyKey: string;
  mediaAssetId?: string;
  file: UploadableVideo;
}

const processing = new Set(["UPLOADED", "VERIFYING", "QUEUED", "PROCESSING"]);

function videoName(asset: ImagePicker.ImagePickerAsset): string {
  const fromUri = asset.uri.split("/").at(-1)?.split("?")[0];
  return (asset.fileName || fromUri || "video").slice(0, 255);
}

function videoType(asset: ImagePicker.ImagePickerAsset, name: string): "video/mp4" | "video/webm" | null {
  const type = (asset.mimeType ?? "").toLowerCase();
  if (type === "video/mp4" || (!type && name.toLowerCase().endsWith(".mp4"))) return "video/mp4";
  if (type === "video/webm" || (!type && name.toLowerCase().endsWith(".webm"))) return "video/webm";
  return null;
}

function errorMessage(error: unknown): string {
  return mediaUploadError(error);
}

export default function LecturerMediaUpload() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [courses, setCourses] = useState<TeachingCourse[] | null>(null);
  const [lessons, setLessons] = useState<LecturerLesson[] | null>(null);
  const [courseId, setCourseId] = useState("");
  const [lesson, setLesson] = useState<LecturerLesson | null>(null);
  const [video, setVideo] = useState<UploadableVideo | null>(null);
  const [asset, setAsset] = useState<MobileMediaAsset | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingMediaUpload | null>(null);
  const [restoringUpload, setRestoringUpload] = useState(false);
  const [progress, setProgress] = useState({ complete: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const attemptRef = useRef<UploadAttempt | null>(null);
  const uploadController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
    const controller = new AbortController();
    setCourses(null);
    setError("");
    void session
      .request("/api/v1/me/owned-courses", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setCourses(lecturerCourses(value));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [retry, session, snapshot.user?.role, snapshot.user?.userId]);

  useEffect(() => {
    if (!courseId || snapshot.user?.role !== "LECTURER") {
      setLessons(null);
      return;
    }
    const controller = new AbortController();
    setLessons(null);
    setError("");
    void session
      .request(`/api/v1/courses/${courseId}/lessons`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          const ordered = lecturerLessons(value).sort(
            (left, right) =>
              left.position.sectionOrder - right.position.sectionOrder ||
              left.position.lessonOrder - right.position.lessonOrder,
          );
          setLessons(ordered);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [courseId, session, snapshot.user?.role, snapshot.user?.userId]);

  useEffect(() => {
    if (!lesson || snapshot.user?.role !== "LECTURER" || !snapshot.user.userId) {
      setPendingUpload(null);
      setRestoringUpload(false);
      return;
    }
    const controller = new AbortController();
    setPendingUpload(null);
    setAsset(null);
    setVideo(null);
    setAttached(false);
    setRestoringUpload(true);
    setError("");
    void (async () => {
      try {
        const pending = await loadPendingMediaUpload(
          session.api.origin,
          snapshot.user!.userId,
          courseId,
          lesson.lessonId,
        );
        if (controller.signal.aborted || !pending) return;
        setPendingUpload(pending);
        attemptRef.current = {
          idempotencyKey: pending.idempotencyKey,
          mediaAssetId: pending.mediaAssetId,
          file: {
            uri: "",
            name: pending.fileName,
            mimeType: pending.mimeType,
            sizeBytes: pending.sizeBytes,
          },
        };
        const current = await refreshMediaAsset(session, pending.mediaAssetId, controller.signal);
        if (controller.signal.aborted) return;
        if (current.status === "DELETED") {
          await clearPendingMediaUpload(session.api.origin, snapshot.user!.userId, courseId, lesson.lessonId);
          setPendingUpload(null);
          attemptRef.current = null;
        } else {
          setAsset(current);
          setMessage(
            `Có phiên tải lên còn hiệu lực cho ${pending.fileName}. Chọn lại đúng video để tiếp tục.`,
          );
        }
      } catch (reason) {
        if (!controller.signal.aborted && reason instanceof ApiError && reason.status === 404) {
          await clearPendingMediaUpload(
            session.api.origin,
            snapshot.user!.userId,
            courseId,
            lesson.lessonId,
          ).catch(() => {});
          setPendingUpload(null);
          attemptRef.current = null;
          setError("Phiên tải lên cũ không còn trên máy chủ. Chọn lại video để bắt đầu phiên mới.");
        } else if (!controller.signal.aborted) {
          setError(errorMessage(reason));
        }
      } finally {
        if (!controller.signal.aborted) setRestoringUpload(false);
      }
    })();
    return () => controller.abort();
  }, [courseId, lesson?.lessonId, session, snapshot.user?.role, snapshot.user?.userId]);

  useEffect(() => {
    if (!asset || !processing.has(asset.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await refreshMediaAsset(session, asset.mediaAssetId, controller.signal);
        if (controller.signal.aborted) return;
        setAsset(next);
        if (processing.has(next.status)) timer = setTimeout(() => void poll(), 2500);
      } catch (reason) {
        if (!controller.signal.aborted) setMessage(errorMessage(reason));
      }
    };
    timer = setTimeout(() => void poll(), 1200);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [asset?.mediaAssetId, asset?.status, session]);

  useEffect(() => () => uploadController.current?.abort(), []);

  const chooseVideo = useCallback(async () => {
    setError("");
    setMessage("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Cần quyền truy cập thư viện để chọn video bài giảng.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const picked = result.assets[0];
    const name = videoName(picked);
    const mimeType = videoType(picked, name);
    if (!mimeType) {
      setVideo(null);
      setError("Chỉ hỗ trợ video MP4 hoặc WebM. Hãy chọn tệp có định dạng được hỗ trợ.");
      return;
    }
    try {
      const file = new File(picked.uri);
      if (!file.exists || !Number.isSafeInteger(file.size) || file.size <= 0) {
        setError("Không đọc được tệp video đã chọn.");
        return;
      }
      if (
        pendingUpload &&
        (pendingUpload.fileName !== name ||
          pendingUpload.sizeBytes !== file.size ||
          pendingUpload.mimeType !== mimeType)
      ) {
        setVideo(null);
        setError("Để tiếp tục, hãy chọn đúng video của phiên tải lên đang chờ.");
        return;
      }
      setVideo({ uri: picked.uri, name, mimeType, sizeBytes: file.size });
      setError("");
      setProgress({ complete: 0, total: 0 });
      setAttached(false);
      if (pendingUpload) {
        attemptRef.current = {
          idempotencyKey: pendingUpload.idempotencyKey,
          mediaAssetId: pendingUpload.mediaAssetId,
          file: { uri: picked.uri, name, mimeType, sizeBytes: file.size },
        };
      } else {
        setAsset(null);
        attemptRef.current = null;
      }
    } catch {
      setError("Không thể mở tệp video trên thiết bị.");
    }
  }, [pendingUpload]);

  const startUpload = useCallback(async () => {
    if (!video || !courseId || !lesson || lesson.preview || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    uploadController.current = controller;
    const current = attemptRef.current;
    const attempt: UploadAttempt =
      current &&
      current.file.name === video.name &&
      current.file.sizeBytes === video.sizeBytes &&
      current.file.mimeType === video.mimeType
        ? current
        : { idempotencyKey: Crypto.randomUUID(), file: video };
    attemptRef.current = attempt;
    try {
      const completed = await uploadLessonVideo(session, {
        courseId,
        lessonId: lesson.lessonId,
        file: video,
        idempotencyKey: attempt.idempotencyKey,
        ...(attempt.mediaAssetId ? { mediaAssetId: attempt.mediaAssetId } : {}),
        signal: controller.signal,
        onAsset: async (next) => {
          attempt.mediaAssetId = next.mediaAssetId;
          attempt.file = video;
          setAsset(next);
          const pending: PendingMediaUpload = {
            courseId,
            lessonId: lesson.lessonId,
            mediaAssetId: next.mediaAssetId,
            idempotencyKey: attempt.idempotencyKey,
            fileName: video.name,
            mimeType: video.mimeType,
            sizeBytes: video.sizeBytes,
          };
          await savePendingMediaUpload(session.api.origin, snapshot.user!.userId, pending);
          setPendingUpload(pending);
        },
        onProgress: (complete, total) => setProgress({ complete, total }),
      });
      setAsset(completed);
      setMessage("Video đã tải lên. Đang kiểm tra và chuyển mã; chỉ có thể gắn khi trạng thái Sẵn sàng.");
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
      setBusy(false);
    }
  }, [busy, courseId, lesson, session, snapshot.user?.userId, video]);

  const cancelUpload = useCallback(async () => {
    if (!asset || busy || asset.status !== "UPLOADING") return;
    uploadController.current?.abort();
    setBusy(true);
    setError("");
    try {
      const value = await session.request(`/api/v1/media-assets/${asset.mediaAssetId}/cancel`, {
        method: "POST",
        body: {},
      });
      setAsset(mediaUploadAsset(value));
      await clearPendingMediaUpload(
        session.api.origin,
        snapshot.user!.userId,
        asset.courseId,
        asset.lessonId,
      ).catch(() => {});
      setPendingUpload(null);
      attemptRef.current = null;
      setVideo(null);
      setMessage("Đã hủy phiên tải lên.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [asset, busy, session, snapshot.user?.userId]);

  const attachVideo = useCallback(async () => {
    if (!asset || asset.status !== "READY" || busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await session.request(`/api/v1/media-assets/${asset.mediaAssetId}/attach`, {
        method: "POST",
        body: {},
      });
      setAsset(mediaUploadAsset(value));
      await clearPendingMediaUpload(
        session.api.origin,
        snapshot.user!.userId,
        asset.courseId,
        asset.lessonId,
      ).catch(() => {});
      setPendingUpload(null);
      attemptRef.current = null;
      setVideo(null);
      setAttached(true);
      setMessage("Đã gắn video vào bài học. Máy chủ sẽ cung cấp luồng phát sau khi nội dung được xuất bản.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [asset, busy, session, snapshot.user?.userId]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <ScreenHeader title={uiText("Tải video bài học")} onBack={() => router.replace("/")} />
        <Text accessibilityRole="alert" style={styles.error}>
          {uiText("Chức năng này chỉ dành cho Giảng viên.")}
        </Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const activeCourse = courses?.find((item) => item.courseId === courseId);
  const lockedSelection =
    restoringUpload || Boolean(pendingUpload) || Boolean(asset && asset.status !== "DELETED");

  return (
    <Page testID="lecturer-media-upload">
      <ScreenHeader
        title={uiText("Tải video bài học")}
        subtitle={uiText("Chọn khóa học và bài học để tải video riêng tư lên")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/account"))}
      />
      <View
        style={{
          ...tokens.shadow.subtle,
          backgroundColor: tokens.color.brandLight,
          borderRadius: 14,
          padding: 14,
          gap: 6,
        }}
      >
        <Text style={{ color: tokens.color.brandDark, fontWeight: "700" }}>
          {uiText("Video được tải trực tiếp theo từng phần")}
        </Text>
        <Text style={styles.small}>
          {uiText(
            "Chỉ hỗ trợ MP4/WebM. Video được kiểm tra và chuyển mã trên máy chủ; chưa phát cho học viên cho đến khi trạng thái READY và được gắn vào bài học.",
          )}
        </Text>
      </View>

      <Text style={styles.title}>{uiText("1. Chọn khóa học")}</Text>
      {courses === null && !error ? (
        <ActivityIndicator accessibilityLabel={uiText("Đang tải khóa học")} color={tokens.color.brand} />
      ) : null}
      {courses?.length === 0 ? (
        <Text style={styles.text}>{uiText("Bạn chưa có khóa học để quản lý video.")}</Text>
      ) : null}
      {courses?.map((item) => (
        <Pressable
          key={item.courseId}
          accessibilityRole="button"
          accessibilityState={{ selected: courseId === item.courseId, disabled: lockedSelection }}
          disabled={lockedSelection}
          onPress={() => {
            setCourseId(item.courseId);
            setLesson(null);
            setVideo(null);
            setAsset(null);
            setPendingUpload(null);
            setAttached(false);
            attemptRef.current = null;
          }}
          style={{
            padding: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: courseId === item.courseId ? tokens.color.brand : tokens.color.border,
            backgroundColor: tokens.color.surface,
            opacity: lockedSelection ? 0.72 : 1,
          }}
        >
          <Text style={{ color: tokens.color.ink, fontWeight: "600" }}>{item.title}</Text>
        </Pressable>
      ))}

      {activeCourse ? (
        <Text style={styles.title}>
          {uiText("2. Chọn bài học trong ")}
          {activeCourse.title}
        </Text>
      ) : null}
      {courseId && lessons === null && !error ? (
        <ActivityIndicator accessibilityLabel={uiText("Đang tải bài học")} color={tokens.color.brand} />
      ) : null}
      {lessons?.length === 0 ? (
        <Text style={styles.text}>{uiText("Khóa học này chưa có bài học.")}</Text>
      ) : null}
      {lessons?.map((item) => {
        const selected = lesson?.lessonId === item.lessonId;
        return (
          <Pressable
            key={item.lessonId}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: lockedSelection || item.preview }}
            accessibilityLabel={uiText("{0}{1}", [
              item.title,
              item.preview ? ", bài xem trước, không hỗ trợ video riêng tư" : "",
            ])}
            disabled={lockedSelection || item.preview}
            onPress={() => {
              setLesson(item);
              setVideo(null);
              setAsset(null);
              setPendingUpload(null);
              setAttached(false);
              attemptRef.current = null;
            }}
            style={{
              padding: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: selected ? tokens.color.brand : tokens.color.border,
              backgroundColor: item.preview ? tokens.color.surfaceSubtle : tokens.color.surface,
              opacity: lockedSelection ? 0.72 : 1,
            }}
          >
            <Text style={{ color: tokens.color.ink, fontWeight: "600" }}>
              {item.position.sectionOrder}.{item.position.lessonOrder} · {item.title}
            </Text>
            {item.sectionTitle ? <Text style={styles.small}>{item.sectionTitle}</Text> : null}
            {item.preview ? (
              <Text style={styles.small}>
                {uiText("Xem trước · hãy tắt chế độ này trên bài học trước khi tải video riêng tư")}
              </Text>
            ) : null}
          </Pressable>
        );
      })}

      {lesson && !lesson.preview ? (
        <>
          <Text style={styles.title}>{uiText("3. Chọn video")}</Text>
          {pendingUpload ? (
            <Text style={styles.text}>
              {uiText("Phiên đang chờ: ")}
              {pendingUpload.fileName} · {(pendingUpload.sizeBytes / 1024 / 1024).toFixed(1)}{" "}
              {uiText("MiB. Chọn lại đúng video để tiếp tục tải các phần còn thiếu.")}
            </Text>
          ) : null}
          <Button
            label={video ? uiText("Chọn video khác") : uiText("Chọn MP4 hoặc WebM từ thư viện")}
            variant="secondary"
            disabled={
              busy || restoringUpload || Boolean(asset && !["DELETED", "UPLOADING"].includes(asset.status))
            }
            onPress={() => void chooseVideo()}
          />
          {video ? (
            <Text style={styles.text}>
              {video.name} · {(video.sizeBytes / 1024 / 1024).toFixed(1)} MiB
            </Text>
          ) : null}
          <Button
            label={
              busy
                ? uiText("Đang tải video…")
                : attemptRef.current?.mediaAssetId
                  ? uiText("Tiếp tục tải phần còn thiếu")
                  : uiText("Tải video lên")
            }
            disabled={!video || busy || Boolean(asset && !["DELETED", "UPLOADING"].includes(asset.status))}
            onPress={() => void startUpload()}
          />
          {progress.total > 0 ? (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: progress.total, now: progress.complete }}
            >
              <Text style={styles.text}>
                {uiText("Đã tải ")}
                {progress.complete} / {progress.total} {uiText(" phần")}
              </Text>
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  overflow: "hidden",
                  backgroundColor: tokens.color.border,
                }}
              >
                <View
                  style={{
                    height: 8,
                    width: `${Math.round((progress.complete / progress.total) * 100)}%`,
                    backgroundColor: tokens.color.brand,
                  }}
                />
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {asset ? (
        <View style={[styles.card, { gap: 8 }]}>
          <Text style={{ color: tokens.color.ink, fontWeight: "700" }}>
            {uiText("Trạng thái: ")}
            {MEDIA_STATUS_COPY[asset.status]}
          </Text>
          <Text style={styles.small}>{asset.originalFilename}</Text>
          {asset.failureCode ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {uiText("Mã lỗi xử lý: ")}
              {asset.failureCode}
            </Text>
          ) : null}
          {asset.status === "READY" && !attached ? (
            <Button
              label={busy ? uiText("Đang gắn…") : uiText("Gắn video vào bài học")}
              disabled={busy}
              onPress={() => void attachVideo()}
            />
          ) : null}
          {attached ? (
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {uiText("Video đã được gắn.")}
            </Text>
          ) : null}
          {asset.status === "UPLOADING" ? (
            <Button
              label={uiText("Hủy phiên tải lên")}
              variant="danger"
              disabled={busy}
              onPress={() => void cancelUpload()}
            />
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {uiText(error)}
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {uiText(message)}
        </Text>
      ) : null}
      <Button
        label={uiText("Tải lại danh sách")}
        variant="outline"
        disabled={busy}
        onPress={() => setRetry((value) => value + 1)}
      />
      <Button
        label={uiText("Đăng xuất")}
        variant="ghost"
        disabled={busy}
        onPress={() => void session.logout().catch(() => {})}
      />
    </Page>
  );
}
