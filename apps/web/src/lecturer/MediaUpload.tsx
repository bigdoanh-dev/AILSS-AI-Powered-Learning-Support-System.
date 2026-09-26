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
    <section className="form-panel" aria-label="Video bài giảng riêng tư">
      <h2>Video bài giảng riêng tư</h2>
      <p>
        Video tải trực tiếp lên kho riêng tư. Sau khi mở lại trình duyệt, chọn lại đúng tệp để tiếp tục các
        phần còn thiếu trong phiên còn hiệu lực.
      </p>
      {pending ? (
        <p role="status">
          Có phiên tải lên chưa hoàn tất cho {pending.name}. Chọn lại chính tệp đó để tiếp tục.
        </p>
      ) : null}
      {pending ? (
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
          Hủy phiên tải lên cũ
        </button>
      ) : null}
      {preview ? (
        <p role="status">Tắt “Xem trước” để dùng video có bảo vệ. Trailer công khai là luồng riêng.</p>
      ) : (
        <>
          <label>
            Chọn video MP4 hoặc WebM{" "}
            <input
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
          {file ? (
            <p>
              {file.name} · {(file.size / 1024 ** 2).toFixed(1)} MiB
            </p>
          ) : null}
          <button className="button" disabled={!file || busy} onClick={() => void upload()}>
            {busy ? "Đang tải…" : "Tải video / thử lại phần còn thiếu"}
          </button>
          {total > 0 ? (
            <>
              <progress aria-label="Tiến độ tải video" max={total} value={done} />
              <p role="status">
                {done}/{total} phần đã tải
              </p>
            </>
          ) : null}
        </>
      )}
      {asset ? (
        <>
          <p role="status">
            {statuses[asset.status] ?? asset.status} · {asset.originalFilename}
          </p>
          {asset.failureCode ? <p role="alert">{asset.failureCode}</p> : null}
          {asset.status === "READY" ? (
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await lecturerRequest(`/media-assets/${asset.mediaAssetId}/attach`, "POST", {});
                  setMessage("Đã gắn video Sẵn sàng vào bài học.");
                } catch (error) {
                  setMessage(lecturerError(error));
                }
              }}
            >
              Gắn video đã xử lý vào bài học
            </button>
          ) : null}
          {asset.status === "READY" ? (
            <div>
              <p>Phụ đề WebVTT cho video này</p>
              <input
                aria-label="Chọn tệp phụ đề WebVTT"
                type="file"
                accept=".vtt,text/vtt"
                onChange={(event) => setCaptionFile(event.target.files?.[0] ?? null)}
              />
              <label>
                Ngôn ngữ{" "}
                <input aria-label="Ngôn ngữ phụ đề" value={captionLanguage} maxLength={35} onChange={(event) => setCaptionLanguage(event.target.value)} />
              </label>
              <label>
                Tên phụ đề{" "}
                <input aria-label="Tên phụ đề" value={captionLabel} maxLength={80} onChange={(event) => setCaptionLabel(event.target.value)} />
              </label>
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
                {captionBusy ? "Đang lưu phụ đề…" : "Thêm phụ đề"}
              </button>
              {asset.captionTracks?.length ? <p role="status">{asset.captionTracks.map((track) => track.label).join(", ")}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
      <p role="status">{message}</p>
    </section>
  );
}
