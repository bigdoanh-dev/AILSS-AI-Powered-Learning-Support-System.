import { useEffect, useRef, useState } from "react";
import { lecturerError, lecturerRequest } from "./api";
interface Asset {
  mediaAssetId: string;
  status: string;
  originalFilename: string;
  failureCode?: string;
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
  const [file, setFile] = useState<File | null>(null),
    [asset, setAsset] = useState<Asset | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(0),
    [total, setTotal] = useState(0);
  const attempt = useRef<{ file: File; key: string; id?: string } | null>(null),
    controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
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
      if (!attempt.current || attempt.current.file !== file)
        attempt.current = { file, key: crypto.randomUUID() };
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
        Video tải trực tiếp lên kho riêng tư. Giữ trang mở trong khi tải. Có thể thử lại phần lỗi trong cùng
        phiên.
      </p>
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
        </>
      ) : null}
      <p role="status">{message}</p>
    </section>
  );
}
