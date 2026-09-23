import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { BlurTargetView, BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { runtime } from "../../src/runtime";
import { ApiError } from "../../src/api";
import type { Session, Snapshot } from "../../src/session";
import { askTutor, type TutorCatalogCourse, type TutorCitation } from "../../src/adaptive";
import { useStudentLearning } from "../../src/use-student-learning";
import { TutorAvatar } from "../../src/TutorAvatar";
import { Icon, tokens } from "../../src/ui";

type TutorMode = "STUDENT_ADVISOR" | "STUDY_BUDDY";
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: TutorCitation[];
  catalogCourses?: TutorCatalogCourse[];
};

const advisorPrompts = ["Tìm khóa học phù hợp với người mới bắt đầu", "Mình chưa biết nên chọn khóa học nào"];
const studyPrompts = [
  "Giải thích phần mình đang học và dẫn tài liệu liên quan",
  "Xem năng lực và lộ trình học của mình",
];

export default function TutorScreen() {
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  if (auth.state !== "AUTHENTICATED" && auth.state !== "OFFLINE_CACHE") return <Redirect href="/login" />;
  if (auth.user?.role !== "STUDENT") return <Redirect href="/" />;

  // Remount synchronously on account change; a passive effect could briefly paint another user's messages.
  return <TutorChat key={auth.user.userId} session={session} auth={auth} />;
}

function TutorChat({ session, auth }: { session: Session; auth: Snapshot }) {
  const params = useLocalSearchParams<{ courseId?: string }>();
  const [mode, setMode] = useState<TutorMode>(params.courseId ? "STUDY_BUDDY" : "STUDENT_ADVISOR");
  // Course snapshots are only needed in Study Buddy, not for catalog advice.
  const data = useStudentLearning(
    session,
    mode === "STUDY_BUDDY" ? auth.user?.userId : undefined,
    auth.state,
  );
  const [courseId, setCourseId] = useState(params.courseId ?? "");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [nativeGlass, setNativeGlass] = useState(false);
  const [error, setError] = useState("");
  const [showCourses, setShowCourses] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const glassTarget = useRef<View | null>(null);
  const pendingPrompt = useRef("");
  const sendInFlight = useRef(false);
  const nextMessageId = useRef(0);
  const thread = useRef<ScrollView | null>(null);
  const lastParamCourse = useRef(params.courseId);

  useEffect(() => {
    // Liquid Glass is an iOS 26+ native API; all other runtimes keep the legible frosted fallback.
    if (Platform.OS === "ios") setNativeGlass(isGlassEffectAPIAvailable());
  }, []);

  const resetConversation = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    sendInFlight.current = false;
    setBusy(false);
    setMessages([]);
    setConversationId(undefined);
    setDraft("");
    setError("");
    pendingPrompt.current = "";
  }, []);

  const invalidateInFlight = useCallback((notice: string) => {
    if (!controller.current) return;
    controller.current.abort();
    controller.current = null;
    sendInFlight.current = false;
    setBusy(false);
    setMessages([]);
    setConversationId(undefined);
    setDraft(pendingPrompt.current);
    pendingPrompt.current = "";
    setError(notice);
  }, []);

  useEffect(() => {
    if (params.courseId && params.courseId !== lastParamCourse.current) {
      lastParamCourse.current = params.courseId;
      resetConversation();
      setCourseId(params.courseId);
      setMode("STUDY_BUDDY");
    }
  }, [params.courseId, resetConversation]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active")
        invalidateInFlight(
          "Yêu cầu bị ngắt khi rời ứng dụng. Câu hỏi đã được giữ lại; lần gửi tiếp theo sẽ bắt đầu cuộc trò chuyện mới.",
        );
    });
    return () => {
      subscription.remove();
      const active = controller.current;
      controller.current = null;
      active?.abort();
    };
  }, [invalidateInFlight]);

  const selectedCourse = data.courses.find((item) => item.course.courseId === courseId);
  const selectedCourseId = selectedCourse?.course.courseId ?? "";

  const chooseMode = useCallback(
    (nextMode: TutorMode) => {
      if (nextMode === mode) return;
      resetConversation();
      setShowCourses(false);
      setMode(nextMode);
    },
    [mode, resetConversation],
  );

  const chooseCourse = useCallback(
    (nextCourseId: string) => {
      if (nextCourseId === selectedCourseId) {
        setShowCourses(false);
        return;
      }
      resetConversation();
      setCourseId(nextCourseId);
      setShowCourses(false);
    },
    [resetConversation, selectedCourseId],
  );

  const send = useCallback(
    async (prompt?: string) => {
      const message = (prompt ?? draft).trim();
      if (!message || busy || sendInFlight.current) return;
      if (mode === "STUDY_BUDDY" && !selectedCourseId) {
        setError("Chọn một khóa học của bạn trước khi hỏi về bài học.");
        return;
      }
      const abort = new AbortController();
      controller.current = abort;
      pendingPrompt.current = message;
      sendInFlight.current = true;
      setBusy(true);
      setError("");
      setDraft("");
      nextMessageId.current += 1;
      const userMessage: Message = {
        id: `user-${String(nextMessageId.current)}`,
        role: "user",
        content: message,
      };
      setMessages((items) => [...items, userMessage]);
      try {
        const reply = await askTutor(session, {
          mode,
          ...(mode === "STUDY_BUDDY" ? { courseId: selectedCourseId } : {}),
          conversationId,
          message,
          signal: abort.signal,
        });
        if (abort.signal.aborted || controller.current !== abort) return;
        setConversationId(reply.conversationId);
        pendingPrompt.current = "";
        nextMessageId.current += 1;
        setMessages((items) => [
          ...items,
          {
            id: `assistant-${String(nextMessageId.current)}`,
            role: "assistant",
            content: reply.content,
            citations: reply.citations,
            catalogCourses: reply.catalogCourses,
          },
        ]);
        AccessibilityInfo.announceForAccessibility(
          "Gia sư đã trả lời. Vuốt để nghe câu trả lời và nguồn trích dẫn.",
        );
      } catch (reason) {
        if (controller.current === abort) {
          setMessages([]);
          setConversationId(undefined);
          setDraft(message);
          pendingPrompt.current = "";
          const detail = reason instanceof ApiError ? reason.message : "Không thể kết nối với Gia sư AI.";
          setError(
            `${detail} Không thể xác nhận máy chủ đã xử lý câu hỏi hay chưa. Gửi lại sẽ bắt đầu cuộc trò chuyện mới.`,
          );
        }
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          sendInFlight.current = false;
          setBusy(false);
        }
      }
    },
    [busy, conversationId, draft, mode, selectedCourseId, session],
  );

  const offline = auth.state === "OFFLINE_CACHE";
  const prompts = mode === "STUDENT_ADVISOR" ? advisorPrompts : studyPrompts;
  return (
    <KeyboardAvoidingView style={chat.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <BlurTargetView
        ref={glassTarget}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, chat.blurBackdrop]}
      >
        <View style={chat.blueGlow} />
        <View style={chat.mintGlow} />
      </BlurTargetView>
      <View style={chat.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Về trang học tập"
          onPress={() => router.replace("/")}
          style={chat.backButton}
        >
          <Icon name="chevronLeft" size={22} color="#FFFFFF" />
        </Pressable>
        <View accessibilityRole="tablist" style={chat.topSwitch}>
          <View accessibilityRole="tab" accessibilityState={{ selected: true }} style={chat.chatTab}>
            <Text style={chat.chatTabText}>Chat</Text>
          </View>
          <View accessibilityRole="tab" accessibilityState={{ disabled: true }} style={chat.voiceTab}>
            <Text style={chat.voiceTabText}>Voice · sắp có</Text>
          </View>
        </View>
        <View style={chat.topSpacer} />
      </View>

      <View style={[chat.panel, nativeGlass && chat.panelNativeGlass]}>
        {nativeGlass ? (
          <GlassView
            pointerEvents="none"
            glassEffectStyle="regular"
            tintColor="#EAF8FA"
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <BlurView
            pointerEvents="none"
            blurTarget={Platform.OS === "android" ? glassTarget : undefined}
            blurMethod={Platform.OS === "android" ? "dimezisBlurViewSdk31Plus" : undefined}
            intensity={32}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={chat.panelHeader}>
          <TutorAvatar active={busy} size={64} />
          <View style={chat.panelTitleWrap}>
            <Text style={chat.panelTitle}>Gia sư AILSS</Text>
            <Text style={chat.panelSubtitle}>
              {offline ? "Cần kết nối để trò chuyện" : busy ? "Đang tìm câu trả lời…" : "Sẵn sàng trò chuyện"}
            </Text>
          </View>
        </View>

        <View accessibilityRole="tablist" style={chat.modeTabs}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === "STUDENT_ADVISOR" }}
            onPress={() => chooseMode("STUDENT_ADVISOR")}
            style={[chat.modeTab, mode === "STUDENT_ADVISOR" && chat.modeTabActive]}
          >
            <Text style={[chat.modeText, mode === "STUDENT_ADVISOR" && chat.modeTextActive]}>
              Chọn khóa học
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === "STUDY_BUDDY" }}
            onPress={() => chooseMode("STUDY_BUDDY")}
            style={[chat.modeTab, mode === "STUDY_BUDDY" && chat.modeTabActive]}
          >
            <Text style={[chat.modeText, mode === "STUDY_BUDDY" && chat.modeTextActive]}>Hỏi bài học</Text>
          </Pressable>
        </View>

        {mode === "STUDY_BUDDY" && !offline && (
          <View style={chat.courseArea}>
            {data.loading ? (
              <ActivityIndicator color={tokens.color.brand} />
            ) : data.error ? (
              <Pressable accessibilityRole="button" onPress={data.refresh} style={chat.courseNotice}>
                <Text style={chat.courseNoticeText}>Không tải được khóa học. Chạm để thử lại.</Text>
              </Pressable>
            ) : data.courses.length === 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/courses")}
                style={chat.courseNotice}
              >
                <Text style={chat.courseNoticeText}>Bạn chưa có khóa học đang học. Xem khóa học</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Chọn ngữ cảnh khóa học"
                  accessibilityState={{ expanded: showCourses }}
                  onPress={() => setShowCourses((value) => !value)}
                  style={chat.courseButton}
                >
                  <Icon name="book" size={16} color={tokens.color.brand} />
                  <Text numberOfLines={1} style={chat.courseButtonText}>
                    {selectedCourse?.course.title ?? "Chọn khóa học"}
                  </Text>
                  <Icon name="chevronRight" size={15} color={tokens.color.brand} />
                </Pressable>
                {showCourses && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={chat.courseOptions}
                  >
                    {data.courses.map((item) => (
                      <Pressable
                        key={item.course.courseId}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: selectedCourseId === item.course.courseId }}
                        onPress={() => chooseCourse(item.course.courseId)}
                        style={[
                          chat.courseChip,
                          selectedCourseId === item.course.courseId && chat.courseChipActive,
                        ]}
                      >
                        <Text numberOfLines={1} style={chat.courseChipText}>
                          {item.course.title}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            )}
          </View>
        )}

        <ScrollView
          ref={thread}
          style={chat.thread}
          contentContainerStyle={chat.threadContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => thread.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        >
          <View style={chat.greeting}>
            <Text style={chat.greetingText}>
              {mode === "STUDENT_ADVISOR"
                ? "Xin chào! Bạn muốn học điều gì? Mình sẽ hỏi thêm về mục tiêu và trình độ trước khi tìm khóa học phù hợp."
                : "Bạn đang vướng ở phần nào? Mình có thể dùng tài liệu khóa học, năng lực và lộ trình của bạn để giải thích."}
            </Text>
          </View>
          {messages.length === 0 && !offline && (
            <View style={chat.suggestions}>
              {prompts.map((prompt) => (
                <Pressable
                  key={prompt}
                  accessibilityRole="button"
                  accessibilityLabel={prompt}
                  disabled={busy || (mode === "STUDY_BUDDY" && !selectedCourseId)}
                  onPress={() => void send(prompt)}
                  style={chat.suggestion}
                >
                  <Text style={chat.suggestionText}>{prompt}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {messages.map((message) => (
            <View
              key={message.id}
              accessibilityLiveRegion={message.role === "assistant" ? "polite" : "none"}
              style={[chat.message, message.role === "user" ? chat.userMessage : chat.botMessage]}
            >
              <Text style={[chat.messageText, message.role === "user" && chat.userMessageText]}>
                {message.content.replace(
                  /^INSUFFICIENT_EVIDENCE:\s*/u,
                  "Chưa tìm thấy đủ bằng chứng trong tài liệu được cấp quyền: ",
                )}
              </Text>
              {message.citations?.map((citation, index) => (
                <View key={`${citation.sourceId}-${String(index)}`} style={chat.citation}>
                  <Text style={chat.citationTitle}>
                    Nguồn {String(index + 1)}: {citation.title}
                  </Text>
                  {citation.snippet ? <Text style={chat.citationSnippet}>{citation.snippet}</Text> : null}
                  {citation.lessonId && citation.courseId ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`Mở bài học ${citation.title}`}
                      onPress={() =>
                        router.push(`/learn/${citation.courseId}/lessons/${citation.lessonId}` as Href)
                      }
                      style={chat.citationLink}
                    >
                      <Text style={chat.citationLinkText}>Mở bài học</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {message.catalogCourses && message.catalogCourses.length > 0 ? (
                <View style={chat.catalogMatches}>
                  <Text style={chat.catalogCaption}>Khóa học đang có trong danh mục</Text>
                  {message.catalogCourses.map((course) => (
                    <Pressable
                      key={course.courseId}
                      accessibilityRole="link"
                      accessibilityLabel={`Xem khóa học ${course.title}`}
                      onPress={() => router.push(`/courses/${course.courseId}` as Href)}
                      style={chat.catalogCourse}
                    >
                      <Text style={chat.catalogTitle}>{course.title}</Text>
                      <Text style={chat.catalogPrice}>
                        {course.priceAmount === 0
                          ? "Miễn phí"
                          : `${course.priceAmount.toLocaleString("vi-VN")} ${course.priceCurrency}`}
                      </Text>
                      <Text style={chat.catalogOpen}>Xem khóa học ›</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
          {busy && (
            <View style={chat.thinking}>
              <ActivityIndicator size="small" color={tokens.color.brand} />
              <Text style={chat.thinkingText}>Gia sư đang suy nghĩ…</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  invalidateInFlight(
                    "Đã dừng yêu cầu. Câu hỏi đã được giữ lại; lần gửi tiếp theo sẽ bắt đầu cuộc trò chuyện mới.",
                  )
                }
                style={chat.cancelButton}
              >
                <Text style={chat.cancelText}>Dừng</Text>
              </Pressable>
            </View>
          )}
          {error ? (
            <View accessibilityRole="alert" style={chat.errorBox}>
              <Text style={chat.errorText}>{error}</Text>
              {!offline && draft.trim() ? (
                <Text style={chat.errorHint}>Câu hỏi vẫn ở ô nhập để bạn gửi lại.</Text>
              ) : null}
            </View>
          ) : null}
          {offline && (
            <View style={chat.errorBox}>
              <Text style={chat.errorText}>Gia sư cần kết nối mạng để trả lời từ dữ liệu thật.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void session.restore()}
                style={chat.reconnect}
              >
                <Text style={chat.reconnectText}>Kết nối lại</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        <View style={chat.composer}>
          <TextInput
            accessibilityLabel="Câu hỏi cho Gia sư AI"
            accessibilityHint={
              mode === "STUDENT_ADVISOR" ? "Hỏi về lựa chọn khóa học" : "Hỏi về khóa học đã chọn"
            }
            multiline
            maxLength={4000}
            editable={!offline}
            value={draft}
            onChangeText={setDraft}
            placeholder={mode === "STUDENT_ADVISOR" ? "Bạn muốn học gì?" : "Hỏi về bài học của bạn…"}
            placeholderTextColor="#89939F"
            style={chat.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Gửi câu hỏi"
            accessibilityState={{
              disabled: offline || busy || !draft.trim() || (mode === "STUDY_BUDDY" && !selectedCourseId),
            }}
            disabled={offline || busy || !draft.trim() || (mode === "STUDY_BUDDY" && !selectedCourseId)}
            onPress={() => void send()}
            style={[chat.sendButton, (offline || busy || !draft.trim()) && chat.sendButtonDisabled]}
          >
            <Text style={chat.sendArrow}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const chat = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#06283D", overflow: "hidden" },
  blurBackdrop: { backgroundColor: "#06283D" },
  blueGlow: {
    position: "absolute",
    top: -190,
    right: -130,
    width: 510,
    height: 510,
    borderRadius: 255,
    backgroundColor: "#087DC7",
    opacity: 0.58,
  },
  mintGlow: {
    position: "absolute",
    bottom: -240,
    left: -145,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: "#85DCC1",
    opacity: 0.76,
  },
  topBar: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  topSpacer: { width: 44 },
  topSwitch: { flexDirection: "row", alignItems: "center", gap: 4 },
  chatTab: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: "rgba(242,252,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    justifyContent: "center",
    shadowColor: "#001B2B",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  chatTabText: { color: "#112B37", fontSize: 14, fontWeight: "700" },
  voiceTab: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" },
  voiceTabText: { color: "#D6EDF2", fontSize: 13, fontWeight: "600" },
  panel: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: 12,
    borderRadius: 30,
    backgroundColor: "rgba(245,252,252,0.94)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.78)",
    shadowColor: "#052D46",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  panelNativeGlass: { backgroundColor: "transparent" },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    backgroundColor: "rgba(255,255,255,0.23)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.46)",
  },
  panelTitleWrap: { flex: 1, gap: 3 },
  panelTitle: { fontSize: 18, fontWeight: "700", color: "#143342" },
  panelSubtitle: { fontSize: 12, color: "#647984" },
  modeTabs: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 9,
    padding: 4,
    borderRadius: 15,
    backgroundColor: "rgba(224,239,241,0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.78)",
  },
  modeTab: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    paddingHorizontal: 4,
  },
  modeTabActive: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.92)",
    shadowColor: "#0A4C59",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  modeText: { fontSize: 13, fontWeight: "600", color: "#667E87" },
  modeTextActive: { color: "#087980", fontWeight: "700" },
  courseArea: { paddingHorizontal: 20, paddingTop: 10 },
  courseButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(226,246,244,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
  },
  courseButtonText: { flex: 1, fontSize: 12, fontWeight: "600", color: "#075F66" },
  courseOptions: { gap: 8, paddingTop: 8, paddingBottom: 2 },
  courseChip: {
    maxWidth: 220,
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.82)",
    backgroundColor: "rgba(255,255,255,0.52)",
  },
  courseChipActive: { borderColor: "#0A7E85", backgroundColor: "rgba(218,246,243,0.96)" },
  courseChipText: { fontSize: 12, color: "#1C555B" },
  courseNotice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#FFF6E4",
  },
  courseNoticeText: { fontSize: 12, color: "#805D1B" },
  thread: { flex: 1 },
  threadContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 17, paddingBottom: 18, gap: 12 },
  greeting: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    borderRadius: 17,
    borderTopLeftRadius: 5,
    backgroundColor: "rgba(255,255,255,0.84)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 15,
    paddingVertical: 12,
    shadowColor: "#17435A",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  greetingText: { color: "#26343B", fontSize: 14, lineHeight: 21 },
  suggestions: { alignItems: "flex-start", gap: 8 },
  suggestion: {
    minHeight: 44,
    maxWidth: "95%",
    paddingHorizontal: 13,
    paddingVertical: 10,
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    backgroundColor: "rgba(255,255,255,0.58)",
  },
  suggestionText: { color: "#0C6B70", fontSize: 13, lineHeight: 18 },
  message: { maxWidth: "94%", borderRadius: 17, paddingHorizontal: 15, paddingVertical: 12, gap: 9 },
  userMessage: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 5,
    backgroundColor: "#087780",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)",
  },
  botMessage: {
    alignSelf: "flex-start",
    borderTopLeftRadius: 5,
    backgroundColor: "rgba(255,255,255,0.91)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.96)",
  },
  messageText: { color: "#172D37", fontSize: 14, lineHeight: 21 },
  userMessageText: { color: "#FFFFFF" },
  citation: { gap: 5, borderLeftWidth: 2, borderLeftColor: "#26A69A", paddingLeft: 10, paddingVertical: 3 },
  citationTitle: { color: "#0A666E", fontSize: 12, fontWeight: "700" },
  citationSnippet: { color: "#536773", fontSize: 12, lineHeight: 18 },
  citationLink: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  citationLinkText: { color: "#087C82", fontSize: 12, fontWeight: "700" },
  catalogMatches: { gap: 7, marginTop: 5 },
  catalogCaption: { color: "#536773", fontSize: 12, fontWeight: "700" },
  catalogCourse: {
    minHeight: 62,
    gap: 3,
    justifyContent: "center",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    backgroundColor: "rgba(255,255,255,0.86)",
  },
  catalogTitle: { color: "#123F48", fontSize: 13, fontWeight: "700" },
  catalogPrice: { color: "#09737C", fontSize: 12, fontWeight: "700" },
  catalogOpen: { color: "#0B6A77", fontSize: 11 },
  thinking: {
    alignSelf: "flex-start",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: "#F3F7F6",
  },
  thinkingText: { color: "#54717B", fontSize: 12 },
  cancelButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  cancelText: { color: "#0B777F", fontSize: 12, fontWeight: "700" },
  errorBox: { alignSelf: "stretch", gap: 5, borderRadius: 12, backgroundColor: "#FFF0E8", padding: 11 },
  errorText: { color: "#A3472E", fontSize: 12, lineHeight: 18 },
  errorHint: { color: "#895A45", fontSize: 11 },
  reconnect: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  reconnectText: { color: "#0A7E85", fontWeight: "700" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.7)",
    backgroundColor: "rgba(238,248,248,0.58)",
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 116,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.98)",
    backgroundColor: "rgba(255,255,255,0.88)",
    color: "#172D37",
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
    shadowColor: "#17435A",
    shadowOpacity: 0.06,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#087780",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#03434E",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  sendButtonDisabled: { backgroundColor: "#B4C7C8" },
  sendArrow: { color: "#FFFFFF", fontSize: 24, fontWeight: "700", lineHeight: 27 },
});
