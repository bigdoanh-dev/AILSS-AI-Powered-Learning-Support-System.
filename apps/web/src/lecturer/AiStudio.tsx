import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { Breadcrumbs, EmptyState, StateChip, useUnsavedChanges } from "../components/product";
import { lecturerError, lecturerRequest, month, useLecturer } from "./api";
import { State } from "./ui";
import { useAiLive } from "./useAiLive";
import { useAiUsage } from "./useAiUsage";
import "./ai-studio.css";

const cognitiveLabels = {
  RECOGNITION: "Nhận biết",
  UNDERSTANDING: "Thông hiểu",
  APPLICATION: "Vận dụng",
  ADVANCED_APPLICATION: "Vận dụng cao",
} as const;
type CognitiveLevel = keyof typeof cognitiveLabels;
const cognitiveHints: Record<CognitiveLevel, string> = {
  RECOGNITION: "Nhớ khái niệm, định nghĩa và dữ kiện.",
  UNDERSTANDING: "Giải thích, so sánh và diễn giải kiến thức.",
  APPLICATION: "Áp dụng kiến thức vào tình huống cụ thể.",
  ADVANCED_APPLICATION: "Phân tích nhiều bước, kết hợp kiến thức để giải quyết vấn đề.",
};
const cognitiveEntries = Object.entries(cognitiveLabels) as [CognitiveLevel, string][];

type DocumentState =
  "UPLOAD_PENDING" | "EXTRACTION_QUEUED" | "EXTRACTING" | "EXTRACTED" | "FAILED" | "QUARANTINED";
type DocumentDto = {
  documentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: DocumentState;
  version: number;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};
type Intent = DocumentDto & { objectKey: string; uploadUrl: string; expiresAt: string };
type JobState = "QUEUED" | "PROCESSING" | "VALIDATING" | "AI_DRAFT" | "FAILED" | "APPROVED" | "CANCELLED";
type Job = {
  jobId: string;
  jobKind: "QUIZ_GENERATION";
  state: JobState;
  version: number;
  targetType: "COURSE" | "CLASS";
  targetId: string;
  documentId: string;
  draftId?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};
type Option = { id: string; text: string };
type ObjectiveQuestion = {
  id: string;
  order: number;
  text: string;
  points: string;
  cognitiveLevel?: CognitiveLevel;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  options?: Option[];
  correctAnswer:
    { optionId: string } | { optionIds: string[] } | { value: boolean } | { acceptedAnswer: string };
};
type ObjectiveQuiz = { schemaVersion: "objective-v1"; title: string; questions: ObjectiveQuestion[] };
type Draft = {
  draftId: string;
  draftVersion: number;
  validationStatus: string;
  questionCount: number;
  state: string;
  checksum: string;
  content: ObjectiveQuiz;
  createdAt: string;
};
type Approval = {
  jobId: string;
  draftId: string;
  state: "APPROVED";
  approvedDraftVersion: 2;
  assessment: { quizId: string; quizVersion: 1; status: "DRAFT" };
};
type Course = { courseId: string; title: string };
type ClassItem = { classId: string; name: string };

const stateCopy: Record<string, string> = {
  QUEUED: "Đang xếp yêu cầu",
  PROCESSING: "AI đang tạo câu hỏi",
  VALIDATING: "Đang kiểm tra cấu trúc câu hỏi",
  AI_DRAFT: "Bản nháp đã sẵn sàng",
  FAILED: "Không thể tạo bản nháp",
  APPROVED: "Đã được giảng viên phê duyệt",
  CANCELLED: "Đã hủy",
  UPLOAD_PENDING: "Đang chuẩn bị tải lên",
  EXTRACTION_QUEUED: "Đang chờ xử lý nội dung",
  EXTRACTING: "Đang xử lý nội dung",
  EXTRACTED: "Sẵn sàng sử dụng",
  QUARANTINED: "Tài liệu không thể sử dụng",
};
const terminal = new Set<JobState>(["AI_DRAFT", "FAILED", "APPROVED", "CANCELLED"]),
  supported = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ]);
async function sha(file: File) {
  const b = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}
const label = (state: string) => stateCopy[state] || state;
const documentFailureCopy: Record<string, string> = {
  DOCX_DECOMPRESSION_LIMIT:
    "Tài liệu DOCX vượt giới hạn xử lý an toàn. Nếu đây là tệp thông thường, hãy lưu lại bằng Word rồi tải lại.",
  DOCX_ACTIVE_CONTENT: "Tài liệu có macro, nội dung nhúng hoặc điều khiển chủ động nên không thể sử dụng.",
  DOCX_MAGIC_MISMATCH: "Nội dung tệp không đúng định dạng DOCX.",
  MALFORMED_DOCX: "Tệp DOCX bị lỗi hoặc thiếu dữ liệu cần thiết.",
  CONTENT_INTEGRITY_MISMATCH: "Tệp nhận được không khớp với tệp đã chọn. Hãy tải lại.",
  CONTENT_TYPE_MISMATCH: "Nội dung tệp không khớp với định dạng đã chọn.",
};
const jobFailureCopy: Record<string, string> = {
  PROVIDER_OUTPUT_REJECTED:
    "Yêu cầu cũ không hoàn thành. Hệ thống chưa lưu nguyên nhân chi tiết cho yêu cầu này. Hãy tạo yêu cầu mới.",
  PROVIDER_UNAVAILABLE:
    "Dịch vụ AI tạm thời không sẵn sàng. Hệ thống đã thử tối đa 3 lần. Bạn có thể tạo lại yêu cầu sau; không cần tải lại tài liệu.",
  RATE_LIMITED:
    "Dịch vụ AI đang giới hạn số yêu cầu hoặc hạn mức sử dụng. Hệ thống đã thử tối đa 3 lần. Hãy chờ rồi thử lại hoặc liên hệ quản trị viên kiểm tra hạn mức.",
  AMBIGUOUS_TIMEOUT:
    "Dịch vụ AI phản hồi quá lâu. Hệ thống đã thử tối đa 3 lần. Hãy thử lại sau hoặc giảm số câu hỏi.",
  PROVIDER_NOT_FOUND:
    "Không tìm thấy model hoặc tài nguyên AI đã cấu hình (404). Quản trị viên cần kiểm tra tên model và địa chỉ API.",
  PROVIDER_ACCESS_DENIED:
    "Dịch vụ AI từ chối quyền truy cập. Quản trị viên cần kiểm tra API key và quyền của dự án.",
  PROVIDER_BAD_REQUEST:
    "Dịch vụ AI không chấp nhận cấu hình yêu cầu. Quản trị viên cần kiểm tra tham số của model.",
  INVALID_RESPONSE:
    "AI trả về dữ liệu không đọc được hoặc không đúng định dạng JSON. Hãy tạo lại yêu cầu hoặc giảm số câu hỏi.",
  AI_STORAGE_ERROR:
    "Không thể đọc tài liệu hoặc lưu kết quả AI. Hãy thử lại; nếu vẫn lỗi, liên hệ quản trị viên kiểm tra kho lưu trữ.",
  OBJECTIVE_V1_INVALID:
    "Nội dung AI trả về chưa đáp ứng cấu trúc bài kiểm tra. Hãy tạo lại yêu cầu hoặc giảm số câu trong một lần tạo.",
};

function useDocument(documentId: string) {
  const [value, setValue] = useState<DocumentDto>(),
    [error, setError] = useState(""),
    [stalled, setStalled] = useState(false);
  useEffect(() => {
    setValue(undefined);
    setError("");
    setStalled(false);
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(documentId)) return;
    const controller = new AbortController(),
      started = Date.now();
    let timer = 0,
      delay = 1500;
    const read = async () => {
      if (document.hidden) {
        timer = window.setTimeout(read, delay);
        return;
      }
      try {
        const r = await lecturerRequest<DocumentDto>(
          `/ai/documents/${documentId}`,
          "GET",
          undefined,
          {},
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setValue(r.data);
        setError("");
        if (["EXTRACTED", "FAILED", "QUARANTINED"].includes(r.data.status)) return;
        setStalled(Date.now() - started > 30000);
        delay = Math.min(8000, Math.round(delay * 1.5));
        timer = window.setTimeout(read, delay);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(lecturerError(e));
          delay = Math.min(10000, delay * 2);
          timer = window.setTimeout(read, delay);
        }
      }
    };
    void read();
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void read();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [documentId]);
  return { value: value?.documentId === documentId ? value : undefined, error, stalled };
}

function AssistantOrb({ busy = false }: { busy?: boolean }) {
  return (
    <div className={`assistant-orb ${busy ? "is-working" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <span>✦</span>
    </div>
  );
}

export function AiStudio() {
  const [activeJob, setActiveJob] = useState(""),
    [requestCopy, setRequestCopy] = useState("");
  const live = useAiLive<Job>(activeJob),
    polled = useJobPolling(activeJob, !live.connected);
  const currentJob = live.connected ? live.job || polled.value : polled.value || live.job;
  const [cognitiveDistribution, setCognitiveDistribution] = useState<Record<CognitiveLevel, number>>({
    RECOGNITION: 2,
    UNDERSTANDING: 3,
    APPLICATION: 3,
    ADVANCED_APPLICATION: 2,
  });
  const count = Object.values(cognitiveDistribution).reduce((sum, value) => sum + value, 0);
  const validDistribution =
    Object.values(cognitiveDistribution).every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 50,
    ) &&
    count >= 1 &&
    count <= 50;
  const working = !!currentJob && !terminal.has(currentJob.state);
  const announced = useRef("");
  useEffect(() => {
    if (
      !currentJob ||
      !["AI_DRAFT", "FAILED"].includes(currentJob.state) ||
      announced.current === currentJob.jobId
    )
      return;
    announced.current = currentJob.jobId;
    window.dispatchEvent(
      new CustomEvent("ailss-ai-complete", { detail: { jobId: currentJob.jobId, state: currentJob.state } }),
    );
  }, [currentJob]);
  const [targetType, setTargetType] = useState("COURSE");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const flight = useRef(false);
  const uploadFlight = useRef(false);
  const [filter, setFilter] = useState<JobState>("AI_DRAFT"),
    [cursor, setCursor] = useState(""),
    [documentId, setDocumentId] = useState(""),
    [uploadStage, setUploadStage] = useState(""),
    [msg, setMsg] = useState("");
  const jobs = useLecturer<Job[]>(
      `/ai/jobs?state=${filter}&month=${month()}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
    usage = useAiUsage(currentJob?.jobId, currentJob?.state),
    courses = useLecturer<Course[] | { items: Course[] }>("/me/owned-courses"),
    classes = useLecturer<ClassItem[] | { classes: ClassItem[] }>("/me/owned-classes"),
    documentQuery = useDocument(documentId);
  const courseItems = courses.data
      ? Array.isArray(courses.data)
        ? courses.data
        : courses.data.items || []
      : [],
    classItems = classes.data
      ? Array.isArray(classes.data)
        ? classes.data
        : classes.data.classes || []
      : [];
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uploadFlight.current) return;
    const file = new FormData(e.currentTarget).get("file") as File;
    const contentType =
      file?.type ||
      (file?.name.toLowerCase().endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : file?.name.toLowerCase().endsWith(".txt")
          ? "text/plain"
          : file?.name.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "");
    if (!file?.size || !supported.has(contentType) || file.size > 25 * 1024 * 1024)
      return setMsg("Chọn tệp PDF, DOCX hoặc TXT có dung lượng không quá 25 MiB.");
    uploadFlight.current = true;
    setUploading(true);
    setMsg("");
    let ephemeral: Intent | undefined;
    try {
      setUploadStage("Đang chuẩn bị tải lên");
      const checksum = await sha(file);
      ephemeral = (
        await lecturerRequest<Intent>("/ai/documents/upload-intents", "POST", {
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          sha256: checksum,
        })
      ).data;
      setUploadStage("Đang tải tài liệu");
      const put = await fetch(ephemeral.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
        signal: AbortSignal.timeout(120000),
      });
      if (!put.ok) throw Error("UPLOAD_FAILED");
      setUploadStage("Đang xác nhận");
      await lecturerRequest(`/ai/documents/${ephemeral.documentId}/complete`, "POST", {
        objectKey: ephemeral.objectKey,
        sizeBytes: file.size,
        sha256: checksum,
        contentType,
      });
      setDocumentId(ephemeral.documentId);
      setUploadStage("Đang xử lý nội dung");
      setMsg("Tài liệu đã tải lên. Hệ thống đang xử lý nội dung.");
    } catch (x) {
      setUploadStage("");
      setMsg(
        x instanceof TypeError
          ? "Không kết nối được máy chủ tải tệp. Kiểm tra địa chỉ kho tài liệu và kết nối mạng rồi thử lại."
          : lecturerError(x),
      );
    } finally {
      uploadFlight.current = false;
      setUploading(false);
      ephemeral = undefined;
    }
  }
  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (flight.current) return;
    if (documentQuery.value?.status !== "EXTRACTED") return setMsg("Tài liệu vẫn đang được xử lý.");
    const f = new FormData(e.currentTarget),
      questionTypes = f.getAll("questionTypes").map(String);
    if (!validDistribution)
      return setMsg("Tổng số câu phải từ 1 đến 50; số câu mỗi mức phải là số nguyên không âm.");
    if (!questionTypes.length) return setMsg("Chọn ít nhất một loại câu hỏi.");
    if (Number(f.get("questionCount")) < questionTypes.length)
      return setMsg("Số câu cần ít nhất bằng số loại câu hỏi đã chọn.");
    flight.current = true;
    setGenerating(true);
    setMsg("");
    try {
      const r = await live.create({
        documentId,
        targetType: String(f.get("targetType")),
        targetId: String(f.get("targetId")),
        questionCount: Number(f.get("questionCount")),
        questionTypes,
        difficulty: "MEDIUM",
        cognitiveDistribution,
      });
      setMsg("Yêu cầu đã được tạo. AI sẽ chuẩn bị một bản nháp để bạn xem lại.");
      setRequestCopy(
        `Tạo ${String(f.get("questionCount"))} câu hỏi từ “${documentQuery.value.fileName}” để tôi xem lại.`,
      );
      setActiveJob(r.data.jobId);
    } catch (x) {
      setMsg(
        x instanceof ApiError && x.status === 503
          ? "Chưa thể xác nhận yêu cầu đã được tạo. Hãy thử lại để tiếp tục yêu cầu trước."
          : lecturerError(x),
      );
    } finally {
      flight.current = false;
      setGenerating(false);
    }
  }
  return (
    <>
      <Breadcrumbs items={[{ label: "Giảng dạy", to: "/app/teaching" }, { label: "AI" }]} />
      <section className="assistant-header">
        <div>
          <p className="assistant-kicker">Không gian soạn bài</p>
          <h1>
            Cùng bạn chuẩn bị
            <br />
            bài kiểm tra tiếp theo.
          </h1>
          <p className="lead">
            Đưa học liệu của bạn vào đây. Trợ lý sẽ soạn câu hỏi, chuẩn bị đáp án và gửi bản nháp để bạn
            duyệt.
          </p>
        </div>
        <AssistantOrb busy={working || uploading} />
      </section>
      <div className="assistant-layout">
        <div className="assistant-tools">
          <section className="form-panel">
            <h2>Học liệu của bạn</h2>
            <form onSubmit={(e) => void upload(e)}>
              <label>
                Tệp PDF, DOCX hoặc TXT
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  required
                />
              </label>
              <p>PDF, Word hoặc văn bản · Tối đa 25 MiB</p>
              <button className="button" disabled={uploading}>
                {uploading ? "Đang tải tài liệu…" : "Tải tài liệu"}
              </button>
            </form>
            {uploadStage && (
              <p role="status">
                {documentQuery.value?.status === "EXTRACTED"
                  ? "Tài liệu đã sẵn sàng — bạn có thể tạo câu hỏi."
                  : uploadStage}
              </p>
            )}
            {msg && (
              <p className="ai-feedback" role="status">
                {msg}
              </p>
            )}
            <details className="assistant-existing">
              <summary>Dùng tài liệu đã tải trước đó</summary>
              <label>
                Hoặc dùng mã tài liệu bạn đã tải
                <input value={documentId} onChange={(e) => setDocumentId(e.target.value)} />
              </label>
            </details>
            {documentQuery.value && (
              <article className="ai-document">
                <StateChip state={documentQuery.value.status} />
                <h3>{documentQuery.value.fileName}</h3>
                <p>
                  {label(documentQuery.value.status)} · {(documentQuery.value.sizeBytes / 1024).toFixed(1)}{" "}
                  KiB
                </p>
                {documentQuery.value.status === "EXTRACTED" && <p>Tài liệu đã xử lý xong.</p>}
                {["FAILED", "QUARANTINED"].includes(documentQuery.value.status) && (
                  <p>
                    {documentFailureCopy[documentQuery.value.failureCode || ""] ||
                      "Không thể xử lý tài liệu này. Hãy thử tải lại hoặc chọn tài liệu khác."}
                  </p>
                )}
                {documentQuery.stalled && <p>Quá trình xử lý đang tạm gián đoạn. Bạn có thể thử lại sau.</p>}
              </article>
            )}
            {documentQuery.error && <p role="alert">{documentQuery.error}</p>}
          </section>
          <section className="form-panel">
            <h2>Thiết lập bài kiểm tra</h2>
            <form id="assistant-generate" className="form-grid" onSubmit={(e) => void generate(e)}>
              <label>
                Đích sử dụng
                <select name="targetType" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
                  <option value="COURSE">Khóa học</option>
                  <option value="CLASS">Lớp học</option>
                </select>
              </label>
              <label>
                Khóa học hoặc lớp
                <select name="targetId" key={targetType} required>
                  <option value="">Chọn đích</option>
                  {targetType === "COURSE" &&
                    courseItems.map((x) => (
                      <option key={x.courseId} value={x.courseId}>
                        {x.title}
                      </option>
                    ))}
                  {targetType === "CLASS" &&
                    classItems.map((x) => (
                      <option key={x.classId} value={x.classId}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Số câu
                <input
                  name="questionCount"
                  type="number"
                  min="1"
                  max="50"
                  value={Number.isFinite(count) ? count : ""}
                  readOnly
                  required
                />
              </label>
              <fieldset className="cognitive-distribution">
                <legend>Phân bố mức độ nhận thức</legend>
                <p>Nhập số câu ở từng mức. Nhập 0 nếu không sử dụng mức đó.</p>
                {cognitiveEntries.map(([level, label]) => (
                  <label key={level}>
                    {label}
                    <input
                      type="number"
                      min="0"
                      max="50"
                      step="1"
                      required
                      value={Number.isNaN(cognitiveDistribution[level]) ? "" : cognitiveDistribution[level]}
                      aria-describedby={`hint-${level}`}
                      onChange={(e) =>
                        setCognitiveDistribution((current) => ({
                          ...current,
                          [level]: e.target.valueAsNumber,
                        }))
                      }
                    />
                    <small id={`hint-${level}`}>{cognitiveHints[level]}</small>
                  </label>
                ))}
                <p role="status">
                  {validDistribution
                    ? `Tổng: ${count} câu hỏi`
                    : "Tổng phải từ 1 đến 50 câu; mỗi mức là số nguyên không âm."}
                </p>
                <small>Đây là mức nhận thức dự kiến. Giảng viên cần kiểm tra nội dung trước khi duyệt.</small>
              </fieldset>
              <fieldset>
                <legend>Loại câu hỏi</legend>
                {[
                  ["SINGLE_CHOICE", "Một đáp án"],
                  ["MULTIPLE_CHOICE", "Nhiều đáp án"],
                  ["TRUE_FALSE", "Đúng / Sai"],
                  ["SHORT_ANSWER", "Trả lời ngắn"],
                ].map(([v, t]) => (
                  <label className="answer-option" key={v}>
                    <input type="checkbox" name="questionTypes" value={v} defaultChecked /> {t}
                  </label>
                ))}
              </fieldset>
              <p>AI sẽ tạo một bản nháp. Bạn cần kiểm tra nội dung và đáp án trước khi phê duyệt.</p>
              <button
                className="button"
                disabled={
                  !validDistribution ||
                  uploading ||
                  generating ||
                  working ||
                  documentQuery.value?.status !== "EXTRACTED"
                }
              >
                {generating ? "Đang tạo yêu cầu…" : "Tạo câu hỏi từ học liệu"}
              </button>
              {documentQuery.value?.status !== "EXTRACTED" && (
                <small>
                  {!documentId
                    ? "Tải tài liệu ở bước 1 để bắt đầu."
                    : documentQuery.error
                      ? "Chưa đọc được tài liệu. Kiểm tra mã tài liệu."
                      : "Đợi tài liệu xử lý xong trước khi tạo câu hỏi."}
                </small>
              )}
            </form>
          </section>
        </div>
        <section className="assistant-conversation" aria-label="Hội thoại tạo câu hỏi">
          <header>
            <div className="assistant-avatar">✦</div>
            <div>
              <h2>Trợ lý soạn câu hỏi</h2>
              <span className={live.connected ? "assistant-online" : "assistant-offline"}>
                {live.connected ? "Đang kết nối trực tiếp" : "Cập nhật định kỳ"}
              </span>
            </div>
            <Link className="button secondary" to="/app/notifications">
              Thông báo
            </Link>
          </header>
          <div className="assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
            <article className="assistant-message">
              <span>Trợ lý</span>
              <p>
                Bạn muốn chuẩn bị bài kiểm tra nào hôm nay? Chọn học liệu và lớp học, tôi sẽ giúp bạn tạo một
                bản nháp có đáp án.
              </p>
              <div className="assistant-presets">
                <button
                  type="button"
                  onClick={() => {
                    setCognitiveDistribution({
                      RECOGNITION: 4,
                      UNDERSTANDING: 4,
                      APPLICATION: 2,
                      ADVANCED_APPLICATION: 0,
                    });
                  }}
                >
                  Ôn tập nhanh · 10 câu
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCognitiveDistribution({
                      RECOGNITION: 2,
                      UNDERSTANDING: 4,
                      APPLICATION: 8,
                      ADVANCED_APPLICATION: 6,
                    });
                  }}
                >
                  Kiểm tra nâng cao · 20 câu
                </button>
              </div>
            </article>
            {documentQuery.value && (
              <article className="assistant-message">
                <span>Học liệu</span>
                <p>
                  <strong>{documentQuery.value.fileName}</strong>
                </p>
                <p>
                  {documentQuery.value.status === "EXTRACTED"
                    ? "Tôi đã nhận được nội dung. Bạn có thể gửi yêu cầu tạo câu hỏi."
                    : ["FAILED", "QUARANTINED"].includes(documentQuery.value.status)
                      ? "Tài liệu chưa thể sử dụng. Xem lý do trong phần học liệu."
                      : "Hệ thống đang đọc nội dung tài liệu…"}
                </p>
              </article>
            )}
            {requestCopy && (
              <article className="assistant-message from-user">
                <span>Bạn</span>
                <p>{requestCopy}</p>
              </article>
            )}
            {currentJob && (
              <article className="assistant-message assistant-task" key={currentJob.state}>
                <span>Trợ lý</span>
                <h3>{label(currentJob.state)}</h3>
                {working ? (
                  <>
                    <div className="assistant-thinking" aria-label="Đang soạn câu hỏi">
                      <b />
                      <b />
                      <b />
                    </div>
                    <p>
                      Tôi đang chuẩn bị câu hỏi và đáp án từ tài liệu. Bản nháp sẽ hiện ở đây khi hoàn thành.
                    </p>
                  </>
                ) : currentJob.state === "FAILED" ? (
                  <p role="alert">
                    {jobFailureCopy[currentJob.failureCode || ""] ||
                      "Chưa thể tạo bản nháp. Bạn hãy thử lại sau."}
                  </p>
                ) : (
                  <p>Bạn có thể mở công việc để xem nội dung và trạng thái mới nhất.</p>
                )}
                <Link className="button" to={`/app/teaching/ai/jobs/${currentJob.jobId}`}>
                  {currentJob.state === "AI_DRAFT" ? "Xem và duyệt câu hỏi" : "Mở chi tiết công việc"}
                </Link>
              </article>
            )}
          </div>
          <footer className="assistant-composer">
            <p>
              <strong>{count || 0} câu hỏi</strong> ·{" "}
              {cognitiveEntries
                .filter(([level]) => cognitiveDistribution[level] > 0)
                .map(([level, label]) => `${cognitiveDistribution[level]} ${label.toLowerCase()}`)
                .join(" · ")}
            </p>
            <button
              className="button"
              form="assistant-generate"
              disabled={
                !validDistribution ||
                uploading ||
                generating ||
                working ||
                documentQuery.value?.status !== "EXTRACTED"
              }
            >
              {working ? "Đang soạn câu hỏi…" : generating ? "Đang gửi…" : "Gửi yêu cầu tạo câu hỏi ↑"}
            </button>
            <small>Bạn kiểm tra và duyệt trước khi xuất bản.</small>
          </footer>
        </section>
      </div>
      <section>
        <h2>Công việc của tôi</h2>
        <div className="inline-actions">
          <label>
            Trạng thái
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as JobState);
                setCursor("");
              }}
            >
              {(
                [
                  "QUEUED",
                  "PROCESSING",
                  "VALIDATING",
                  "AI_DRAFT",
                  "FAILED",
                  "APPROVED",
                  "CANCELLED",
                ] as JobState[]
              ).map((x) => (
                <option key={x} value={x}>
                  {label(x)}
                </option>
              ))}
            </select>
          </label>
          <span>Tháng {month()}</span>
        </div>
        <State q={jobs}>
          {(items) =>
            items.length ? (
              <div className="workspace-cards">
                {items.map((x) => (
                  <article key={x.jobId}>
                    <StateChip state={x.state} />
                    <h3>{label(x.state)}</h3>
                    <p>
                      {x.targetType === "COURSE" ? "Khóa học" : "Lớp học"} ·{" "}
                      {new Date(x.createdAt).toLocaleString("vi-VN")}
                    </p>
                    <Link to={`/app/teaching/ai/jobs/${x.jobId}`}>Mở công việc →</Link>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Không có công việc ở trạng thái này.">
                Chọn trạng thái khác hoặc tạo một yêu cầu mới.
              </EmptyState>
            )
          }
        </State>
        {jobs.meta?.nextCursor && (
          <button className="button secondary" onClick={() => setCursor(jobs.meta!.nextCursor!)}>
            Trang tiếp theo
          </button>
        )}
      </section>
      <State q={usage}>
        {(v) => (
          <section className="ai-usage">
            <h2>Mức sử dụng hôm nay</h2>
            <p>
              <strong>{v.remaining}</strong> / {v.limit} câu còn lại
            </p>
            <p>
              {v.consumed} đã dùng · {v.reserved} đang được giữ cho công việc xử lý.
            </p>
            <p>Hạn mức làm mới lúc 00:00 mỗi ngày (giờ Việt Nam). Số liệu tính theo ngày gửi yêu cầu.</p>
          </section>
        )}
      </State>
      <details className="form-panel">
        <summary>Hướng dẫn sử dụng AI an toàn</summary>
        <p>
          Chỉ tải học liệu bạn được phép sử dụng. Luôn kiểm tra câu hỏi, đáp án và ngữ cảnh trước khi phê
          duyệt. Bài kiểm tra chỉ đến với học viên sau bước xuất bản riêng trong Assessment.
        </p>
      </details>
    </>
  );
}

function useJobPolling(jobId: string, enabled = true) {
  const [value, setValue] = useState<Job>(),
    [error, setError] = useState(""),
    [stalled, setStalled] = useState(false),
    revision = useRef(0);
  useEffect(() => {
    setValue(undefined);
    if (!jobId || !enabled) return;
    const controller = new AbortController(),
      started = Date.now(),
      epoch = ++revision.current;
    let timer = 0,
      delay = 1200;
    const read = async () => {
      if (document.hidden) {
        timer = window.setTimeout(read, delay);
        return;
      }
      try {
        const r = await lecturerRequest<Job>(`/ai/jobs/${jobId}`, "GET", undefined, {}, controller.signal);
        if (controller.signal.aborted || epoch !== revision.current) return;
        setValue(r.data);
        setError("");
        if (terminal.has(r.data.state)) return;
        setStalled(Date.now() - started > 30000);
        delay = Math.min(8000, Math.round(delay * 1.5));
        timer = window.setTimeout(read, delay);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(lecturerError(e));
          delay = Math.min(10000, delay * 2);
          timer = window.setTimeout(read, delay);
        }
      }
    };
    void read();
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void read();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [jobId, enabled]);
  return {
    value,
    error,
    stalled,
    reload: () => {
      revision.current += 1;
      location.reload();
    },
  };
}

export function AiJob() {
  const { jobId = "" } = useParams(),
    live = useAiLive<Job>(jobId),
    polled = useJobPolling(jobId, !live.connected),
    job = { ...polled, value: live.connected ? live.job || polled.value : polled.value || live.job },
    drafts = useLecturer<Draft[]>(
      job.value?.state === "AI_DRAFT" || job.value?.state === "APPROVED" ? `/ai/jobs/${jobId}/drafts` : null,
    ),
    [msg, setMsg] = useState("");
  const cancel = async () => {
    if (
      !confirm(
        "Hủy yêu cầu này sẽ dừng quá trình tạo bản nháp nếu hệ thống vẫn có thể hủy ở trạng thái hiện tại.",
      )
    )
      return;
    try {
      await lecturerRequest(`/ai/jobs/${jobId}/cancel`, "POST", {});
      setMsg("Đã cập nhật trạng thái từ máy chủ.");
      job.reload();
    } catch (e) {
      setMsg(lecturerError(e));
    }
  };
  return (
    <>
      <Breadcrumbs items={[{ label: "AI", to: "/app/teaching/ai" }, { label: "Công việc" }]} />
      {job.value ? (
        <section className="ai-job-status assistant-job">
          <AssistantOrb busy={!terminal.has(job.value.state)} />
          <StateChip state={job.value.state} />
          <h1>{label(job.value.state)}</h1>
          <p>
            {job.value.targetType === "COURSE" ? "Khóa học" : "Lớp học"} · tạo lúc{" "}
            {new Date(job.value.createdAt).toLocaleString("vi-VN")}
          </p>
          {!terminal.has(job.value.state) && <div className="ai-indeterminate" aria-label="Đang xử lý" />}
          {job.stalled && <p>Quá trình xử lý đang tạm gián đoạn. Bạn có thể thử lại sau.</p>}
          {job.value.state === "FAILED" && (
            <div className="ai-job-failure" role="alert">
              <p>
                {jobFailureCopy[job.value.failureCode || ""] ||
                  "Không thể tạo bản nháp do dịch vụ AI gặp lỗi. Hãy quay lại và tạo một yêu cầu mới."}
              </p>
              <Link className="button" to="/app/teaching/ai">
                Tạo yêu cầu mới
              </Link>
            </div>
          )}
          {["QUEUED", "PROCESSING", "VALIDATING"].includes(job.value.state) && (
            <button className="button secondary" onClick={() => void cancel()}>
              Hủy yêu cầu
            </button>
          )}
          <details>
            <summary>Chi tiết</summary>
            <p>Mã công việc: {job.value.jobId}</p>
            <p>Phiên bản trạng thái: v{job.value.version}</p>
          </details>
        </section>
      ) : (
        <p role="status">Đang đọc trạng thái…</p>
      )}
      {job.error && <p role="alert">{job.error}</p>}
      <p role="status">{msg}</p>
      {(job.value?.state === "AI_DRAFT" || job.value?.state === "APPROVED") && (
        <State q={drafts}>
          {(items) =>
            items[0] ? (
              <ReviewEditor draft={items[0]} />
            ) : (
              <EmptyState title="Bản nháp chưa sẵn sàng.">
                Hệ thống đang đồng bộ nội dung bản nháp. Hãy tải lại trang sau ít phút.
              </EmptyState>
            )
          }
        </State>
      )}
    </>
  );
}

function reviewErrors(q: ObjectiveQuiz) {
  return q.questions.flatMap((x, i) => {
    const p = `Câu ${i + 1}: `,
      e: string[] = [],
      answer = x.correctAnswer;
    if (!x.text.trim()) e.push(p + "chưa có nội dung.");
    if (Number(x.points) <= 0) e.push(p + "điểm chưa hợp lệ.");
    if (x.options && (x.options.length < 2 || x.options.some((o) => !o.text.trim())))
      e.push(p + "chưa có đủ lựa chọn.");
    if (
      x.type === "SINGLE_CHOICE" &&
      (!("optionId" in answer) || !x.options?.map((o) => o.id).includes(answer.optionId))
    )
      e.push(p + "chưa chọn đáp án đúng.");
    if (x.type === "MULTIPLE_CHOICE" && (!("optionIds" in answer) || !answer.optionIds.length))
      e.push(p + "chưa chọn đáp án đúng.");
    if (x.type === "SHORT_ANSWER" && (!("acceptedAnswer" in answer) || !answer.acceptedAnswer.trim()))
      e.push(p + "chưa có đáp án.");
    return e;
  });
}

function ReviewEditor({ draft }: { draft: Draft }) {
  const [review, setReview] = useState(() => structuredClone(draft.content)),
    [selected, setSelected] = useState(0),
    [dirty, setDirty] = useState(false),
    [msg, setMsg] = useState(""),
    [approval, setApproval] = useState<Approval>(),
    [conflict, setConflict] = useState(false);
  useUnsavedChanges(
    dirty && !approval,
    "Các chỉnh sửa bản nháp chưa được lưu trên máy chủ. Rời trang và bỏ thay đổi?",
  );
  const errors = useMemo(() => reviewErrors(review), [review]),
    question = review.questions[selected];
  const update = (patch: Partial<ObjectiveQuestion>) => {
    setReview((v) => ({
      ...v,
      questions: v.questions.map((q, i) => (i === selected ? ({ ...q, ...patch } as ObjectiveQuestion) : q)),
    }));
    setDirty(true);
  };
  function removeQuestion(index: number) {
    if (review.questions.length <= 1) {
      alert("Bản nháp cần ít nhất 1 câu hỏi.");
      return;
    }
    if (!confirm(`Bạn có chắc muốn xóa Câu ${index + 1}?`)) return;
    setReview((v) => ({
      ...v,
      questions: v.questions.filter((_, i) => i !== index).map((q, i) => ({ ...q, order: i + 1 })),
    }));
    setSelected((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
    setDirty(true);
  }
  function addQuestion() {
    const newOrder = review.questions.length + 1;
    const newId = `q-${Date.now()}`;
    const newQ: ObjectiveQuestion = {
      id: newId,
      order: newOrder,
      text: "",
      points: "1",
      type: "SINGLE_CHOICE",
      options: [
        { id: "opt-1", text: "" },
        { id: "opt-2", text: "" },
      ],
      correctAnswer: { optionId: "opt-1" },
    };
    setReview((v) => ({
      ...v,
      questions: [...v.questions, newQ],
    }));
    setSelected(review.questions.length);
    setDirty(true);
  }
  async function approve() {
    if (errors.length) return setMsg("Hãy sửa các lỗi trước khi phê duyệt.");
    if (
      !confirm(
        "Phê duyệt bản nháp này sẽ tạo một bài kiểm tra DRAFT trong Assessment. Bài kiểm tra vẫn chưa được xuất bản cho học viên.",
      )
    )
      return;
    try {
      const r = await lecturerRequest<Approval>(
        `/ai/drafts/${draft.draftId}/approve`,
        "POST",
        { reviewedDraft: review },
        { "If-Match": `"v${draft.draftVersion}"` },
      );
      setApproval(r.data);
      setDirty(false);
      setMsg("Đã tạo bài kiểm tra nháp.");
    } catch (e) {
      const stale = e instanceof ApiError && e.status === 409;
      setConflict(stale);
      setMsg(
        stale
          ? "Bản nháp đã thay đổi. Hãy tải phiên bản mới trước khi phê duyệt."
          : e instanceof ApiError && e.status === 503
            ? "Chưa thể xác nhận thao tác đã hoàn tất. Hãy thử lại để hệ thống tiếp tục yêu cầu trước."
            : lecturerError(e),
      );
    }
  }
  if (approval)
    return (
      <section className="ai-approved">
        <p className="eyebrow">GIẢNG VIÊN ĐÃ PHÊ DUYỆT</p>
        <h2>Đã tạo bài kiểm tra nháp.</h2>
        <p>
          Assessment Quiz v{approval.assessment.quizVersion} · Trạng thái DRAFT. Bài kiểm tra chưa được xuất
          bản cho học viên.
        </p>
        <Link className="button" to={`/app/teaching/assessments/${approval.assessment.quizId}`}>
          Mở bài kiểm tra trong Assessment
        </Link>
      </section>
    );
  return (
    <section>
      <div className="ai-review-intro">
        <p className="eyebrow">BẢN NHÁP v{draft.draftVersion}</p>
        <h2>Giảng viên xem lại nội dung.</h2>
        <p>
          AI tạo bản nháp. Giảng viên là người kiểm tra và quyết định nội dung cuối cùng. Các thay đổi chưa
          phê duyệt chỉ nằm trong trang này.
        </p>
      </div>
      <div className="assessment-builder">
        <aside className="builder-nav">
          <h3>Câu hỏi</h3>
          <select
            className="builder-mobile-select"
            aria-label="Chọn câu hỏi"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {review.questions.map((_, i) => (
              <option key={i} value={i}>
                Câu {i + 1}
              </option>
            ))}
          </select>
          <div className="builder-question-list">
            {review.questions.map((x, i) => (
              <div className="builder-question-item" key={x.id || i}>
                <button
                  type="button"
                  className={selected === i ? "active" : ""}
                  onClick={() => setSelected(i)}
                >
                  Câu {i + 1}
                  <small>{x.text || "Chưa có nội dung"}</small>
                </button>
                <button
                  type="button"
                  className="question-remove-btn"
                  aria-label={`Xóa câu ${i + 1}`}
                  title={`Xóa câu ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeQuestion(i);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="button secondary" onClick={addQuestion}>
            + Thêm câu hỏi
          </button>
        </aside>
        <section className="builder-editor" aria-label="Chỉnh sửa câu hỏi">
          <label>
            Tiêu đề
            <input
              value={review.title}
              maxLength={300}
              onChange={(e) => {
                setReview((v) => ({ ...v, title: e.target.value }));
                setDirty(true);
              }}
            />
          </label>
          {question ? (
            <>
              <div className="question-editor-topbar">
                <h3>
                  Câu {selected + 1} / {review.questions.length}
                </h3>
                <button
                  type="button"
                  className="button danger small"
                  onClick={() => removeQuestion(selected)}
                >
                  Xóa câu hỏi này
                </button>
              </div>
              <ObjectiveEditor q={question} update={update} />
            </>
          ) : (
            <p>Chưa có câu hỏi nào. Bấm &quot;+ Thêm câu hỏi&quot; để tạo câu hỏi mới.</p>
          )}
        </section>
        <aside className="builder-summary">
          <h3>Tóm tắt kiểm tra</h3>
          <p>
            {review.questions.length} câu hỏi · {errors.length} lỗi
          </p>
          {errors.length ? (
            <ul className="validation-list">
              {errors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p>Nội dung hợp lệ để gửi máy chủ kiểm tra.</p>
          )}
          {conflict && (
            <div role="alert">
              <p>Bản nháp đã thay đổi. Hãy tải phiên bản mới trước khi phê duyệt.</p>
              <button className="button secondary" onClick={() => location.reload()}>
                Tải bản mới
              </button>
              <button className="button secondary" onClick={() => setConflict(false)}>
                Xem lại thay đổi hiện tại
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setDirty(false);
                  location.reload();
                }}
              >
                Hủy chỉnh sửa cục bộ
              </button>
            </div>
          )}
          <div className="builder-actions">
            <button className="button" onClick={() => void approve()}>
              Phê duyệt và tạo bài kiểm tra nháp
            </button>
          </div>
          <p role="status">{msg}</p>
        </aside>
      </div>
    </section>
  );
}

function ObjectiveEditor({
  q,
  update,
}: {
  q: ObjectiveQuestion;
  update: (p: Partial<ObjectiveQuestion>) => void;
}) {
  const answerIds = "optionIds" in q.correctAnswer ? q.correctAnswer.optionIds : [];
  return (
    <fieldset className="question-editor">
      <legend>
        Câu hỏi {q.order} · {labelType(q.type)}
        {q.cognitiveLevel ? ` · ${cognitiveLabels[q.cognitiveLevel]}` : ""}
      </legend>
      <label>
        Mức độ nhận thức
        <select
          value={q.cognitiveLevel || ""}
          onChange={(e) =>
            update({ cognitiveLevel: (e.target.value || undefined) as CognitiveLevel | undefined })
          }
        >
          <option value="">Chưa phân loại</option>
          {cognitiveEntries.map(([level, label]) => (
            <option key={level} value={level}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nội dung
        <textarea
          rows={5}
          maxLength={4000}
          value={q.text}
          onChange={(e) => update({ text: e.target.value })}
        />
      </label>
      <label>
        Điểm
        <input value={q.points} onChange={(e) => update({ points: e.target.value })} />
      </label>
      {q.options?.map((o, i) => (
        <div className="option-editor" key={o.id}>
          <input
            aria-label={`Lựa chọn ${i + 1}`}
            value={o.text}
            maxLength={1000}
            onChange={(e) =>
              update({ options: q.options!.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })
            }
          />
          <label>
            <input
              name={`answer-${q.id}`}
              type={q.type === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
              checked={
                q.type === "MULTIPLE_CHOICE"
                  ? answerIds.includes(o.id)
                  : "optionId" in q.correctAnswer && q.correctAnswer.optionId === o.id
              }
              onChange={(e) =>
                update({
                  correctAnswer:
                    q.type === "MULTIPLE_CHOICE"
                      ? {
                          optionIds: e.target.checked
                            ? [...answerIds, o.id]
                            : answerIds.filter((x) => x !== o.id),
                        }
                      : { optionId: o.id },
                })
              }
            />
            Đáp án đúng
          </label>
        </div>
      ))}
      {q.type === "TRUE_FALSE" && (
        <div>
          <label>
            <input
              type="radio"
              name={`answer-${q.id}`}
              checked={"value" in q.correctAnswer && q.correctAnswer.value}
              onChange={() => update({ correctAnswer: { value: true } })}
            />
            Đúng
          </label>
          <label>
            <input
              type="radio"
              name={`answer-${q.id}`}
              checked={"value" in q.correctAnswer && !q.correctAnswer.value}
              onChange={() => update({ correctAnswer: { value: false } })}
            />
            Sai
          </label>
        </div>
      )}
      {q.type === "SHORT_ANSWER" && (
        <label>
          Đáp án được chấp nhận
          <input
            maxLength={1000}
            value={"acceptedAnswer" in q.correctAnswer ? q.correctAnswer.acceptedAnswer : ""}
            onChange={(e) => update({ correctAnswer: { acceptedAnswer: e.target.value } })}
          />
        </label>
      )}
    </fieldset>
  );
}
const labelType = (type: string) =>
  ({
    SINGLE_CHOICE: "Một đáp án",
    MULTIPLE_CHOICE: "Nhiều đáp án",
    TRUE_FALSE: "Đúng / Sai",
    SHORT_ANSWER: "Trả lời ngắn",
  })[type] || type;
