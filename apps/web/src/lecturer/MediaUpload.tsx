import { LocalizedFileInput } from "../components/LocalizedFileInput";
import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../auth/session";
import { lecturerError, lecturerRequest } from "./api";
interface Asset {
  mediaAssetId: string;
  status: string;
  originalFilename: string;
  failureCode?: string;
  captionTracks?: { captionTrackId: string; language: string; label: string }[];
}
interface PendingUpload {
  id: string;
  key: string;
  name: string;
  size: number;
  lastModified: number;
}
const pendingKey = (ownerId: string, courseId: string, lessonId: string) =>
  `ailss:media-upload:${ownerId}:${courseId}:${lessonId}`;
function pendingUpload(ownerId: string, courseId: string, lessonId: string): PendingUpload | null {
  if (!ownerId) return null;
  try {
    const raw = localStorage.getItem(pendingKey(ownerId, courseId, lessonId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(item.id) ||
      typeof item.key !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(item.key) ||
      typeof item.name !== "string" ||
      typeof item.size !== "number" ||
      typeof item.lastModified !== "number"
    )
      return null;
    return item as unknown as PendingUpload;
  } catch {
    return null;
  }
}
const statuses: Record<string, string> = {
  CREATED: "Đang tạo phiên tải lên",
  UPLOADING: "Đang tải lên",
  UPLOADED: "Đã tải lên",
  VERIFYING: "Đang kiểm tra",
  QUEUED: "Đang chờ xử lý",
  PROCESSING: "Đang xử lý video",
  READY: "Sẵn sàng",
  FAILED: "Xử lý thất bại",
  QUARANTINED: "Video bị cách ly",
  DELETED: "Đã hủy",
};
export function MediaUpload({
  courseId,
  lessonId,
  preview,
  mediaAssetId,
}: {
  courseId: string;
  lessonId: string;
  preview: boolean;
  mediaAssetId?: string;
}) {
  const uiText = useUiText();
  const { profile } = useSession();
  const ownerId = profile?.userId ?? "";
  const [file, setFile] = useState<File | null>(null),
    [captionFile, setCaptionFile] = useState<File | null>(null),
    [captionLanguage, setCaptionLanguage] = useState("vi"),
    [captionLabel, setCaptionLabel] = useState("Tiếng Việt"),
    [captionBusy, setCaptionBusy] = useState(false),
    [asset, setAsset] = useState<Asset | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<PendingUpload | null>(() => pendingUpload(ownerId, courseId, lessonId)),
    [done, setDone] = useState(0),
    [total, setTotal] = useState(0);
  const attempt = useRef<{ file: File; key: string; id?: string } | null>(null),
    controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  useEffect(() => {
    setPending(pendingUpload(ownerId, courseId, lessonId));
    attempt.current = null;
  }, [ownerId, courseId, lessonId]);
  useEffect(() => {
    const id = asset?.mediaAssetId ?? mediaAssetId;
    if (!id) return;
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const { data } = await lecturerRequest<Asset>(
          `/media-assets/${id}`,
          "GET",
          undefined,
          {},
          control.signal,
        );
        if (control.signal.aborted) return;
        setAsset(data);
        if (["VERIFYING", "QUEUED", "PROCESSING", "UPLOADED"].includes(data.status))
          timer = setTimeout(() => void poll(), 2000);
      } catch (error) {
        if (!control.signal.aborted) setMessage(lecturerError(error));
      }
    };
    void poll();
    return () => {
      control.abort();
      if (timer) clearTimeout(timer);
    };
  }, [asset?.mediaAssetId, asset?.status, mediaAssetId]);
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setMessage("");
    const signal = controller.current.signal;
    try {
      if (!attempt.current || attempt.current.file !== file) {
        const prior = pendingUpload(ownerId, courseId, lessonId);
        if (
          prior &&
          (prior.name !== file.name || prior.size !== file.size || prior.lastModified !== file.lastModified)
        )
          throw Error("Hãy chọn đúng tệp của phiên tải lên trước, hoặc hủy phiên cũ để bắt đầu tệp mới.");
        attempt.current = { file, key: prior?.key ?? crypto.randomUUID(), id: prior?.id };
      }
      const current = attempt.current;
      if (!current.id) {
        const { data } = await lecturerRequest<{ asset: Asset; partSize: number; partCount: number }>(
          `/courses/${courseId}/media-assets`,
          "POST",
          { lessonId, originalFilename: file.name, mimeType: file.type, sizeBytes: file.size },
          { "Idempotency-Key": current.key },
          signal,
        );
        current.id = data.asset.mediaAssetId;
        setAsset(data.asset);
        const record: PendingUpload = {
          id: current.id,
          key: current.key,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
        };
        localStorage.setItem(pendingKey(ownerId, courseId, lessonId), JSON.stringify(record));
        setPending(record);
      }
      const { data: resume } = await lecturerRequest<{
        asset: Asset;
        partSize: number;
        parts: { part: number }[];
      }>(`/media-assets/${current.id}/upload`, "GET", undefined, {}, signal);
      const count = Math.ceil(file.size / resume.partSize),
        uploaded = new Set(resume.parts.map((p) => p.part));
      setTotal(count);
      setDone(uploaded.size);
      for (let part = 1; part <= count; part++)
        if (!uploaded.has(part)) {
          const { data } = await lecturerRequest<{ uploadUrl: string }>(
            `/media-assets/${current.id}/parts`,
            "POST",
            { partNumber: part },
            {},
            signal,
          );
          const response = await fetch(data.uploadUrl, {
            method: "PUT",
            body: file.slice((part - 1) * resume.partSize, Math.min(part * resume.partSize, file.size)),
            credentials: "omit",
            signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
          });
          if (!response.ok)
            throw Error("Tải một phần video thất bại. Thử lại để tiếp tục các phần còn thiếu.");
          uploaded.add(part);
          setDone(uploaded.size);
        }
      const { data } = await lecturerRequest<Asset>(
        `/media-assets/${current.id}/complete`,
        "POST",
        {},
        {},
        signal,
      );
      setAsset(data);
      localStorage.removeItem(pendingKey(ownerId, courseId, lessonId));
      setPending(null);
      setMessage("Đã tải lên. Đang kiểm tra và xử lý HLS; chỉ được xuất bản khi Sẵn sàng.");
    } catch (error) {
      if (!signal.aborted) setMessage(lecturerError(error));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="form-panel lesson-card" aria-label={uiText("Video bài giảng riêng tư")}>
      <div className="lesson-card-header">
        <div className="lesson-card-header-main">
          <div className="lesson-icon-circle">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
              <line x1="7" y1="2" x2="7" y2="22"></line>
              <line x1="17" y1="2" x2="17" y2="22"></line>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <line x1="2" y1="7" x2="7" y2="7"></line>
              <line x1="2" y1="17" x2="7" y2="17"></line>
              <line x1="17" y1="17" x2="22" y2="17"></line>
              <line x1="17" y1="7" x2="22" y2="7"></line>
            </svg>
          </div>
          <div>
            <h2 className="lesson-card-title">{uiText("Video bài giảng riêng tư")}</h2>
            <p className="lesson-card-subtitle">
              {uiText("Tải lên kho lưu trữ đám mây bảo mật & mã hóa HLS đa chất lượng (Adaptive Bitrate).")}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="kpi-tag accent">HLS Encrypted</span>
          <span className="green-badge-pill">{uiText("Kho riêng tư")}</span>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--muted, #64748b)", margin: 0, lineHeight: 1.6 }}>
        {uiText(
          "Video tải trực tiếp lên kho riêng tư. Sau khi mở lại trình duyệt, chọn lại đúng tệp để tiếp tục các phần còn thiếu trong phiên còn hiệu lực.",
        )}
      </p>

      {pending ? (
        <div
          style={{
            background: "#FEF3C7",
            border: "1px solid #FCD34D",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#92400E" }}>
            {uiText("Có phiên tải lên chưa hoàn tất cho ")}
            {pending.name}
            {uiText(". Chọn lại chính tệp đó để tiếp tục.")}
          </p>
          <div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  await lecturerRequest(`/media-assets/${pending.id}/cancel`, "POST", {});
                  localStorage.removeItem(pendingKey(ownerId, courseId, lessonId));
                  setPending(null);
                  attempt.current = null;
                  setAsset(null);
                  setMessage("Đã hủy phiên tải lên cũ.");
                } catch (error) {
                  setMessage(lecturerError(error));
                }
              }}
            >
              {uiText("Hủy phiên tải lên cũ")}
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div
          style={{
            background: "#F1F5F9",
            border: "1px solid #CBD5E1",
            borderRadius: 12,
            padding: "12px 16px",
          }}
        >
          <p role="status" style={{ margin: 0, fontSize: 13, color: "#475569" }}>
            {uiText("Tắt “Xem trước” để dùng video có bảo vệ. Trailer công khai là luồng riêng.")}
          </p>
        </div>
      ) : (
        <div className="media-upload-panel">
          <div className="media-upload-dropzone">
            <div className="media-dropzone-icon">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            </div>
            <div className="media-dropzone-title">{uiText("Chọn tệp video từ thiết bị của bạn")}</div>
            <div className="media-dropzone-hint">
              {uiText(
                "Hỗ trợ định dạng MP4 hoặc WebM, tối đa 2GB. Quá trình tải lên hỗ trợ tạm dừng và tiếp tục mượt mà.",
              )}
            </div>
            <label style={{ cursor: "pointer", marginTop: 6, display: "inline-block" }}>
              {uiText("Chọn video MP4 hoặc WebM")}{" "}
              <LocalizedFileInput
                type="file"
                accept="video/mp4,video/webm"
                disabled={busy}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  attempt.current = null;
                  setDone(0);
                  setTotal(0);
                }}
              />
            </label>
          </div>

          {file ? (
            <div className="media-selected-file-card">
              <div className="media-selected-file-info">
                <span style={{ fontSize: 20 }}>🎬</span>
                <span className="media-selected-file-name">{file.name}</span>
                <span className="media-selected-file-size">{(file.size / 1024 ** 2).toFixed(1)} MiB</span>
              </div>
              <span style={{ fontSize: 12, color: "#0284c7", fontWeight: 700 }}>{uiText("Đã chọn")}</span>
            </div>
          ) : null}

          {file ? (
            <p style={{ display: "none" }}>
              {file.name} · {(file.size / 1024 ** 2).toFixed(1)} MiB
            </p>
          ) : null}

          <div>
            <button
              className="button"
              disabled={!file || busy}
              onClick={() => void upload()}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              {busy ? uiText("Đang tải…") : uiText("Tải video / thử lại phần còn thiếu")}
            </button>
          </div>

          {total > 0 ? (
            <div className="media-progress-box">
              <div className="media-progress-header">
                <span>{uiText("Tiến độ tải dữ liệu theo phân mảnh")}</span>
                <span style={{ color: "#0284c7", fontWeight: 700 }}>
                  {total > 0 ? Math.round((done / total) * 100) : 0}%
                </span>
              </div>
              <div className="media-progress-bar-wrap">
                <div
                  className="media-progress-bar-fill"
                  style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }}
                />
              </div>
              <progress
                aria-label={uiText("Tiến độ tải video")}
                max={total}
                value={done}
                style={{ display: "none" }}
              />
              <p role="status" style={{ margin: 0, fontSize: 12.5, color: "#64748b" }}>
                {done}/{total} {uiText(" phần đã tải")}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {asset ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
          <div
            className={`media-asset-badge-card ${
              asset.status === "READY"
                ? "media-asset-badge-ready"
                : asset.status === "PROCESSING" || asset.status === "VERIFYING"
                  ? "media-asset-badge-processing"
                  : ""
            }`}
          >
            <div className="media-asset-badge-info">
              <span className="media-asset-badge-icon" aria-hidden="true">
                {asset.status === "READY" ? "✅" : asset.status === "FAILED" ? "❌" : "⏳"}
              </span>
              <div className="media-asset-badge-texts">
                <p role="status" className="media-asset-badge-title">
                  <span className="media-asset-badge-status-pill">
                    {uiText(statuses[asset.status] ?? asset.status)}
                  </span>
                  <span className="media-asset-badge-filename">{asset.originalFilename}</span>
                </p>
                <div className="media-asset-badge-meta">
                  <span className="media-asset-meta-label">{uiText("Mã tài nguyên HLS:")}</span>
                  <code className="media-asset-badge-code" title={asset.mediaAssetId}>
                    {asset.mediaAssetId}
                  </code>
                </div>
              </div>
            </div>

            {asset.status === "READY" ? (
              <button
                type="button"
                className="media-asset-attach-btn"
                onClick={async () => {
                  try {
                    await lecturerRequest(`/media-assets/${asset.mediaAssetId}/attach`, "POST", {});
                    setMessage("Đã gắn video Sẵn sàng vào bài học.");
                  } catch (error) {
                    setMessage(lecturerError(error));
                  }
                }}
              >
                <span className="media-attach-icon">🔗</span>
                <span>{uiText("Gắn video đã xử lý vào bài học")}</span>
              </button>
            ) : null}
          </div>

          {asset.failureCode ? (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FCA5A5",
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              <p role="alert" style={{ margin: 0, color: "#991B1B", fontSize: 13, fontWeight: 600 }}>
                {asset.failureCode}
              </p>
            </div>
          ) : null}

          {asset.status === "READY" ? (
            <div className="media-captions-box">
              <div className="media-captions-title">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span>{uiText("Phụ đề WebVTT cho video này")}</span>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: "#64748b" }}>
                {uiText(
                  "Thêm tệp phụ đề song ngữ hoặc tiếng Việt giúp học viên dễ dàng theo dõi bài học và tìm kiếm nội dung theo lời thoại.",
                )}
              </p>

              <div>
                <LocalizedFileInput
                  aria-label={uiText("Chọn tệp phụ đề WebVTT")}
                  type="file"
                  accept=".vtt,text/vtt"
                  onChange={(event) => setCaptionFile(event.target.files?.[0] ?? null)}
                />
              </div>

              <div className="media-captions-grid">
                <label>
                  {uiText("Ngôn ngữ")}{" "}
                  <input
                    aria-label={uiText("Ngôn ngữ phụ đề")}
                    value={captionLanguage}
                    maxLength={35}
                    onChange={(event) => setCaptionLanguage(event.target.value)}
                  />
                </label>
                <label>
                  {uiText("Tên phụ đề")}{" "}
                  <input
                    aria-label={uiText("Tên phụ đề")}
                    value={captionLabel}
                    maxLength={80}
                    onChange={(event) => setCaptionLabel(event.target.value)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="button secondary"
                  disabled={!captionFile || captionBusy}
                  onClick={async () => {
                    if (!captionFile || captionBusy) return;
                    if (captionFile.size > 262144 || captionFile.size === 0) {
                      setMessage("Phụ đề phải là WebVTT và không quá 256 KiB.");
                      return;
                    }
                    setCaptionBusy(true);
                    try {
                      await lecturerRequest(`/media-assets/${asset.mediaAssetId}/captions`, "POST", {
                        language: captionLanguage.trim(),
                        label: captionLabel.trim(),
                        kind: "SUBTITLES",
                        contentType: "text/vtt",
                        content: await captionFile.text(),
                      });
                      const refreshed = await lecturerRequest<Asset>(`/media-assets/${asset.mediaAssetId}`);
                      setAsset(refreshed.data);
                      setMessage("Đã thêm phụ đề cho video.");
                    } catch (error) {
                      setMessage(lecturerError(error));
                    } finally {
                      setCaptionBusy(false);
                    }
                  }}
                >
                  {captionBusy ? uiText("Đang lưu phụ đề…") : uiText("Thêm phụ đề")}
                </button>
              </div>

              {asset.captionTracks?.length ? (
                <div style={{ background: "#F1F5F9", padding: "8px 12px", borderRadius: 8 }}>
                  <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: "#334155" }}>
                    {uiText("Danh sách phụ đề: ")}
                    {asset.captionTracks.map((track) => track.label).join(", ")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div
          style={{
            background: "#F0F9FF",
            border: "1px solid #BAE6FD",
            borderRadius: 10,
            padding: "10px 14px",
            marginTop: 4,
          }}
        >
          <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#0369A1" }}>
            {uiText(message)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
