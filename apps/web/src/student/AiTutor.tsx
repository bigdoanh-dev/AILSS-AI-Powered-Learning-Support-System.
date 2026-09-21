import React, { useState } from "react";
import { Heading } from "./ui";

export type PedagogicalMode =
  | "EXPLAIN"
  | "SOCRATIC"
  | "HINT_ONLY"
  | "PRACTICE"
  | "REVISION"
  | "EXAM_PREP";

interface Message {
  id: string;
  sender: "USER" | "TUTOR";
  text: string;
  mode: PedagogicalMode;
  citations?: { title: string; section: string; snippet: string }[];
  suggestedAction?: string;
}

export function AiTutorPage() {
  const [mode, setMode] = useState<PedagogicalMode>("SOCRATIC");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "msg-1",
      sender: "TUTOR",
      text: "Xin chào! Mình là AI Tutor đồng hành cùng bạn trong môn Cấu trúc Dữ liệu & Giải thuật. Hiện tại mình đang hoạt động ở chế độ Socratic (Gợi mở câu hỏi). Bạn đang gặp khó khăn ở phần nào?",
      mode: "SOCRATIC",
    },
  ]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      sender: "USER",
      text: input,
      mode,
    };

    let tutorReply: Message;
    if (mode === "SOCRATIC") {
      tutorReply = {
        id: `msg-${Date.now() + 1}`,
        sender: "TUTOR",
        text: "Để hiểu thao tác quay cây AVL, hãy nhớ lại: Cây con nào đang làm mất cân bằng chiều cao (Left-heavy hay Right-heavy)? Và nút mất cân bằng nằm ở đâu so với nút mới được chèn?",
        mode: "SOCRATIC",
        citations: [
          {
            title: "Giáo trình Cấu trúc Dữ liệu & Giải thuật nâng cao",
            section: "Chương 4: Cây nhị phân tìm kiếm cân bằng (AVL)",
            snippet: "Thao tác quay đơn Left-Left (LL) xảy ra khi cây con bên trái của nút gốc có chiều cao lớn hơn 1 đơn vị so với cây con bên phải...",
          },
        ],
        suggestedAction: "Xem lại định nghĩa hệ số cân bằng Balance Factor = Height(Left) - Height(Right)",
      };
    } else if (mode === "HINT_ONLY") {
      tutorReply = {
        id: `msg-${Date.now() + 1}`,
        sender: "TUTOR",
        text: "Gợi ý: Hãy kiểm tra trường hợp cơ sở (base case) khi danh sách chỉ có 0 hoặc 1 phần tử. Bạn có cần đệ quy tiếp không?",
        mode: "HINT_ONLY",
      };
    } else {
      tutorReply = {
        id: `msg-${Date.now() + 1}`,
        sender: "TUTOR",
        text: "Cây AVL là cây nhị phân tìm kiếm tự cân bằng, trong đó độ cao của hai cây con của mọi nút chênh lệch không quá 1. Khi chèn hoặc xóa làm vi phạm tính chất này, các thao tác quay (Single Rotation hoặc Double Rotation) được thực hiện để khôi phục cân bằng trong thời gian O(log N).",
        mode: "EXPLAIN",
        citations: [
          {
            title: "Thuật toán và Cấu trúc Dữ liệu",
            section: "Trang 142 - Định lý độ phức tạp phép quay AVL",
            snippet: "Mọi thao tác quay đơn và quay kép đều hoàn tất trong O(1) con trỏ dịch chuyển.",
          },
        ],
      };
    }

    setMessages((prev) => [...prev, userMsg, tutorReply]);
    setInput("");
  };

  return (
    <div className="ai-tutor-container" style={{ padding: "var(--space-6) 0", maxWidth: "900px", margin: "0 auto" }}>
      <Heading title="AI Tutor V2 (Course-Aware & Socratic Guidance)">
        Trợ lý sư phạm cá nhân hóa theo từng môn học, bám sát tài liệu bài giảng và giải trình nguồn tham khảo.
      </Heading>

      {/* Mode Selector */}
      <div style={{ margin: "var(--space-4) 0" }}>
        <label style={{ display: "block", marginBottom: "var(--space-2)", fontWeight: 600 }}>
          Chế độ sư phạm (Pedagogical Mode):
        </label>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {(["EXPLAIN", "SOCRATIC", "HINT_ONLY", "PRACTICE", "REVISION", "EXAM_PREP"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line)",
                background: mode === m ? "var(--blue)" : "var(--white)",
                color: mode === m ? "#fff" : "var(--ink)",
                fontWeight: mode === m ? 700 : 500,
                cursor: "pointer",
              }}
            >
              {m === "EXPLAIN" && "📖 Giải thích trực tiếp"}
              {m === "SOCRATIC" && "💡 Gợi mở Socratic"}
              {m === "HINT_ONLY" && "🔍 Chỉ đưa gợi ý (Hint Only)"}
              {m === "PRACTICE" && "📝 Luyện tập câu hỏi"}
              {m === "REVISION" && "🔄 Ôn tập củng cố"}
              {m === "EXAM_PREP" && "🎯 Luyện thi chuẩn bị"}
            </button>
          ))}
        </div>
      </div>

      {/* Assessment Guard Notice */}
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          background: "#e8f4fd",
          borderLeft: "4px solid var(--blue)",
          borderRadius: "var(--radius-sm)",
          marginBottom: "var(--space-4)",
          fontSize: "0.9rem",
          color: "var(--ink)",
        }}
      >
        🛡️ <strong>Chính sách Hỗ trợ An toàn (Assessment Guard):</strong> AI Tutor giải thích nguyên lý và định hướng tư duy giải quyết vấn đề, tuân thủ nguyên tắc không tiết lộ đáp án trực tiếp đối với các bài kiểm tra có tính điểm.
      </div>

      {/* Chat Messages */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          padding: "var(--space-4)",
          background: "var(--white)",
          minHeight: "380px",
          maxHeight: "500px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.sender === "USER" ? "flex-end" : "flex-start",
              maxWidth: "80%",
            }}
          >
            <div
              style={{
                padding: "var(--space-3) var(--space-4)",
                borderRadius: "var(--radius)",
                background: msg.sender === "USER" ? "var(--blue)" : "#f1f5f9",
                color: msg.sender === "USER" ? "#fff" : "var(--ink)",
                lineHeight: 1.5,
              }}
            >
              {msg.text}
            </div>

            {/* Citations */}
            {msg.citations && msg.citations.length > 0 && (
              <div
                style={{
                  marginTop: "var(--space-2)",
                  padding: "var(--space-2) var(--space-3)",
                  background: "#fafafa",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--muted)" }}>📚 Nguồn tài liệu bài giảng (RAG Citations):</span>
                {msg.citations.map((c, i) => (
                  <div key={i} style={{ marginTop: "4px" }}>
                    <strong>{c.title}</strong> — <em>{c.section}</em>
                    <p style={{ margin: "2px 0 0 0", color: "var(--muted)", fontStyle: "italic" }}>
                      "{c.snippet}"
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Suggested Next Action */}
            {msg.suggestedAction && (
              <div style={{ marginTop: "4px", fontSize: "0.85rem", color: "var(--blue)", fontWeight: 600 }}>
                ⚡ Khuyên dùng tiếp theo: {msg.suggestedAction}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input Box */}
      <form onSubmit={handleSend} style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Nhập câu hỏi của bạn (Chế độ: ${mode})...`}
          style={{
            flex: 1,
            padding: "12px 16px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            fontSize: "1rem",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "12px 24px",
            background: "var(--blue)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-sm)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Gửi
        </button>
      </form>
    </div>
  );
}
