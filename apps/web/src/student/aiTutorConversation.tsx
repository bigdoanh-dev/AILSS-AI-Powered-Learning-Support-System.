import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useSession } from "../auth/session";
import { studentError, studentRequest, useStudent, type LearningCourse } from "./api";

export interface TutorCitation {
  sourceId: string;
  title: string;
  lessonId?: string;
  courseId?: string;
  courseVersion?: number;
  lessonVersion?: number;
  snippet?: string;
}

export interface TutorCatalogCourse {
  courseId: string;
  title: string;
  priceAmount: number;
  priceCurrency: string;
}

export interface TutorMessage {
  id: string;
  sender: "USER" | "TUTOR";
  text: string;
  citations?: TutorCitation[];
  catalogCourses?: TutorCatalogCourse[];
  isStreaming?: boolean;
}

export function tutorPrompts(courseId: string, courseTitle?: string): string[] {
  return courseId
    ? [
        "Mình đang học khóa nào và mức độ hiểu bài ra sao?",
        "Giải thích phần mình đang học bằng ví dụ dễ hiểu",
        courseTitle ? `Gợi ý khóa học liên quan đến ${courseTitle}` : "Mình muốn tìm khóa học về SQL",
      ]
    : [
        "Mình chưa biết nên chọn khóa học nào",
        "Mình mới bắt đầu học lập trình, nên học từ đâu?",
        "Mình muốn tìm khóa học về SQL",
      ];
}

interface ChatResponse {
  conversationId: string;
  messageId: string;
  content: string;
  citations: TutorCitation[];
  catalogCourses?: TutorCatalogCourse[];
  safetyBlocked?: boolean;
}

interface TutorThread {
  conversationId?: string;
  messages: TutorMessage[];
}

export interface TutorSavedConversation {
  conversationId: string;
  title: string;
  updatedAt: string;
  mode: string;
  courseId?: string;
}

interface SavedConversationDetail {
  conversation: TutorSavedConversation;
  messages: Array<{
    messageId: string;
    sender: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
    content: string;
    citations?: TutorCitation[];
    toolResults?: Array<{ name: string; result: unknown }>;
  }>;
}

function archivedCatalogCourses(results?: Array<{ name: string; result: unknown }>): TutorCatalogCourse[] {
  const courses = results?.find((result) => result.name === "search_courses")?.result;
  if (!Array.isArray(courses)) return [];
  return courses
    .filter(
      (course): course is TutorCatalogCourse =>
        typeof course === "object" &&
        course !== null &&
        typeof course.courseId === "string" &&
        typeof course.title === "string" &&
        typeof course.priceAmount === "number" &&
        typeof course.priceCurrency === "string",
    )
    .slice(0, 3);
}

interface TutorConversationValue {
  courseId: string;
  selectCourse: (courseId: string) => void;
  courses: {
    data?: LearningCourse[];
    error?: unknown;
    pending: boolean;
    retry: () => void;
  };
  input: string;
  setInput: (input: string) => void;
  messages: TutorMessage[];
  conversationId?: string;
  archiveOpen: boolean;
  toggleArchive: () => void;
  savedConversations: TutorSavedConversation[];
  archivePending: boolean;
  archiveError: string;
  openSavedConversation: (conversationId: string) => Promise<void>;
  pending: boolean;
  isStreaming: boolean;
  status: string;
  error: string;
  sendMessage: (text?: string) => Promise<void>;
  resetConversation: () => void;
  stopRequest: () => void;
}

const TutorConversationContext = createContext<TutorConversationValue | null>(null);
function formatTutorText(text: string) {
  if (text.startsWith("INSUFFICIENT_EVIDENCE:")) {
    return `Chưa tìm thấy đủ bằng chứng trong tài liệu được cấp quyền: ${text.slice("INSUFFICIENT_EVIDENCE:".length).trim()}`;
  }
  if (text.startsWith("RAG_TOOL_FORBIDDEN:")) {
    return "Bạn không có quyền truy cập tài liệu của khóa học này. Hãy kiểm tra quyền tham gia khóa học.";
  }
  return text;
}

function pause(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException("Đã dừng", "AbortError"));
  if (
    (typeof process !== "undefined" && process.env?.NODE_ENV === "test") ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Đã dừng", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function ConversationStore({ children }: PropsWithChildren) {
  const [courseId, setCourseIdState] = useState("");
  const courses = useStudent<LearningCourse[]>("/me/courses");
  const archive = useStudent<TutorSavedConversation[]>("/assistant/conversations");
  const [thread, setThread] = useState<TutorThread>({ messages: [] });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  const initialCourseChosenRef = useRef(false);
  const sequenceRef = useRef(0);
  const historyRequestRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<{
    controller: AbortController;
    prompt: string;
    responseMessageId?: string;
  } | null>(null);

  useEffect(() => {
    if (initialCourseChosenRef.current || !courses.data) return;
    initialCourseChosenRef.current = true;
    if (!courseId && courses.data.length === 1) setCourseIdState(courses.data[0].courseId);
  }, [courseId, courses.data]);

  useEffect(() => {
    if (!courseId || !courses.data) return;
    if (!courses.data.some((course) => course.courseId === courseId)) setCourseIdState("");
  }, [courseId, courses.data]);

  const updateThread = useCallback((update: (current: TutorThread) => TutorThread) => {
    setThread(update);
  }, []);

  const selectCourse = useCallback((nextCourseId: string) => {
    if (pendingRef.current || historyRequestRef.current) return;
    setCourseIdState(nextCourseId);
    setError("");
  }, []);

  const toggleArchive = useCallback(() => {
    if (!archiveOpen) archive.retry();
    setArchiveOpen(!archiveOpen);
    setHistoryError("");
  }, [archive, archiveOpen]);

  const openSavedConversation = useCallback(async (conversationId: string) => {
    if (pendingRef.current) return;
    historyRequestRef.current?.abort();
    const controller = new AbortController();
    historyRequestRef.current = controller;
    setHistoryPending(true);
    setHistoryError("");
    try {
      const response = await studentRequest<SavedConversationDetail>(
        `/assistant/conversations/${encodeURIComponent(conversationId)}`,
        controller.signal,
      );
      if (controller.signal.aborted || historyRequestRef.current !== controller) return;
      const saved = response.data;
      setThread({
        conversationId: saved.conversation.conversationId,
        messages: saved.messages.flatMap((message) => {
          if (message.sender !== "USER" && message.sender !== "ASSISTANT") return [];
          return [
            {
              id: message.messageId,
              sender: message.sender === "USER" ? ("USER" as const) : ("TUTOR" as const),
              text: message.sender === "USER" ? message.content : formatTutorText(message.content),
              ...(message.citations?.length ? { citations: message.citations } : {}),
              ...(message.sender === "ASSISTANT" && archivedCatalogCourses(message.toolResults).length
                ? { catalogCourses: archivedCatalogCourses(message.toolResults) }
                : {}),
            },
          ];
        }),
      });
      initialCourseChosenRef.current = true;
      setCourseIdState(saved.conversation.courseId ?? "");
      setInput("");
      setError("");
      setArchiveOpen(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setHistoryError(`${studentError(cause)} Hãy thử mở lại cuộc trò chuyện.`);
      }
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = null;
        setHistoryPending(false);
      }
    }
  }, []);

  const resetConversation = useCallback(() => {
    historyRequestRef.current?.abort();
    historyRequestRef.current = null;
    setHistoryPending(false);
    setHistoryError("");
    setArchiveOpen(false);
    const active = activeRequestRef.current;
    if (active) {
      activeRequestRef.current = null;
      active.controller.abort();
      pendingRef.current = false;
      setPending(false);
      setIsStreaming(false);
      setStatus("");
    }
    setThread({ messages: [] });
    initialCourseChosenRef.current = true;
    setCourseIdState("");
    setInput("");
    setError("");
    archive.retry();
  }, [archive]);

  const sendMessage = useCallback(
    async (suggestion?: string) => {
      const text = (suggestion ?? input).trim();
      if (!text || pendingRef.current || historyRequestRef.current) return;
      const conversationId = thread.conversationId;
      const controller = new AbortController();
      const request: NonNullable<typeof activeRequestRef.current> = {
        controller,
        prompt: text,
      };
      activeRequestRef.current = request;
      pendingRef.current = true;
      setPending(true);
      setIsStreaming(false);
      setStatus("Gia sư đang suy nghĩ…");
      setError("");
      setInput("");
      sequenceRef.current += 1;
      const userMessage: TutorMessage = {
        id: `user-${Date.now()}-${sequenceRef.current}`,
        sender: "USER",
        text,
      };
      updateThread((current) => {
        const lastMessage = current.messages[current.messages.length - 1];
        if (lastMessage?.sender === "USER" && lastMessage.text === text) return current;
        return { ...current, messages: [...current.messages, userMessage] };
      });

      const researchTimer = window.setTimeout(() => {
        if (activeRequestRef.current === request) setStatus("Đang tìm thông tin phù hợp…");
      }, 1400);
      const composingTimer = window.setTimeout(() => {
        if (activeRequestRef.current === request) setStatus("Mình đang sắp xếp câu trả lời…");
      }, 5200);

      try {
        const response = await studentRequest<ChatResponse>("/assistant/chat", controller.signal, "POST", {
          ...(conversationId ? { conversationId } : {}),
          mode: courseId ? "STUDY_BUDDY" : "STUDENT_ADVISOR",
          ...(courseId ? { courseId } : {}),
          message: text,
        });
        if (controller.signal.aborted || activeRequestRef.current !== request) return;

        const assistantMessage: TutorMessage = {
          id: response.data.messageId,
          sender: "TUTOR",
          text: "",
          isStreaming: true,
          ...(response.data.citations?.length ? { citations: response.data.citations } : {}),
          ...(response.data.catalogCourses?.length
            ? { catalogCourses: response.data.catalogCourses.slice(0, 3) }
            : {}),
        };
        request.responseMessageId = assistantMessage.id;
        updateThread((current) => ({
          ...current,
          conversationId: response.data.conversationId,
        }));
        archive.retry();
        window.clearTimeout(researchTimer);
        window.clearTimeout(composingTimer);

        await pause(300, controller.signal);
        setIsStreaming(true);
        setStatus("Đang viết câu trả lời…");
        updateThread((current) => ({
          ...current,
          messages: [...current.messages, assistantMessage],
        }));

        const answer = formatTutorText(response.data.content);
        const words = answer.match(/\S+\s*/gu) ?? [answer];
        const groupSize = Math.max(1, Math.ceil(words.length / 72));
        let visibleText = "";
        for (let index = 0; index < words.length; index += groupSize) {
          if (controller.signal.aborted || activeRequestRef.current !== request) return;
          const chunk = words.slice(index, index + groupSize).join("");
          visibleText += chunk;
          updateThread((current) => ({
            ...current,
            messages: current.messages.map((message) =>
              message.id === assistantMessage.id ? { ...message, text: visibleText } : message,
            ),
          }));
          if (index + groupSize < words.length) {
            const waitMs = /[.!?…]\s*$/u.test(chunk) ? 120 : /[,;:]\s*$/u.test(chunk) ? 55 : 32;
            await pause(waitMs, controller.signal);
          }
        }
        updateThread((current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === assistantMessage.id ? { ...message, isStreaming: false } : message,
          ),
        }));
      } catch (cause) {
        if (activeRequestRef.current === request && !controller.signal.aborted) {
          updateThread((current) => ({
            conversationId: current.conversationId,
            messages: request.responseMessageId
              ? current.messages.filter((message) => message.id !== request.responseMessageId)
              : current.messages,
          }));
          setInput(text);
          const detail = studentError(cause);
          setError(
            detail
              ? `${detail} Câu hỏi vẫn được giữ lại để bạn thử lại.`
              : "Không thể kết nối đến Gia sư AI. Câu hỏi vẫn được giữ lại để bạn thử lại.",
          );
        }
      } finally {
        window.clearTimeout(researchTimer);
        window.clearTimeout(composingTimer);
        if (activeRequestRef.current === request) {
          activeRequestRef.current = null;
          pendingRef.current = false;
          setPending(false);
          setIsStreaming(false);
          setStatus("");
        }
      }
    },
    [archive, courseId, input, thread.conversationId, updateThread],
  );

  const stopRequest = useCallback(() => {
    const active = activeRequestRef.current;
    if (!active) return;
    activeRequestRef.current = null;
    active.controller.abort();
    pendingRef.current = false;
    setPending(false);
    setIsStreaming(false);
    setStatus("");
    setInput(active.prompt);
    setError("Đã dừng câu trả lời. Câu hỏi vẫn còn trong đoạn chat để bạn tiếp tục.");
    if (active.responseMessageId) {
      updateThread((current) => ({
        ...current,
        messages: current.messages.filter((message) => message.id !== active.responseMessageId),
      }));
    } else {
      updateThread((current) => ({ ...current, conversationId: undefined }));
    }
  }, [updateThread]);

  useEffect(
    () => () => {
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
      historyRequestRef.current?.abort();
      historyRequestRef.current = null;
    },
    [],
  );

  const value = useMemo<TutorConversationValue>(
    () => ({
      courseId,
      selectCourse,
      courses,
      input,
      setInput,
      messages: thread.messages,
      conversationId: thread.conversationId,
      archiveOpen,
      toggleArchive,
      savedConversations: archive.data ?? [],
      archivePending: archive.pending || historyPending,
      archiveError: historyError || (archive.error ? studentError(archive.error) : ""),
      openSavedConversation,
      pending: pending || historyPending,
      isStreaming,
      status,
      error,
      sendMessage,
      resetConversation,
      stopRequest,
    }),
    [
      thread.messages,
      thread.conversationId,
      archive,
      archiveOpen,
      courseId,
      courses,
      error,
      input,
      isStreaming,
      historyPending,
      historyError,
      openSavedConversation,
      pending,
      resetConversation,
      selectCourse,
      sendMessage,
      status,
      stopRequest,
      toggleArchive,
    ],
  );

  return <TutorConversationContext.Provider value={value}>{children}</TutorConversationContext.Provider>;
}

export function AiTutorConversationProvider({ children }: PropsWithChildren) {
  const { profile } = useSession();
  return <ConversationStore key={profile?.userId ?? "guest"}>{children}</ConversationStore>;
}

export function useOptionalAiTutorConversation() {
  return useContext(TutorConversationContext);
}

export function useAiTutorConversation() {
  const value = useContext(TutorConversationContext);
  if (!value) throw new Error("useAiTutorConversation must be used inside AiTutorConversationProvider");
  return value;
}
