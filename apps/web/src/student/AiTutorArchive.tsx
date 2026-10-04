import { useUiText, useLanguage } from "../lib/i18n";
import { useAiTutorConversation } from "./aiTutorConversation";

function updatedLabel(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

export function AiTutorArchive({ id }: { id: string }) {
  const uiText = useUiText();
  const { locale } = useLanguage();
  const {
    archiveOpen,
    archivePending,
    archiveError,
    savedConversations,
    conversationId,
    pending,
    openSavedConversation,
  } = useAiTutorConversation();

  if (!archiveOpen) return null;

  return (
    <aside id={id} className="ai-tutor-archive" aria-label={uiText("Lịch sử trò chuyện")}>
      <div className="ai-tutor-archive-heading">
        <strong>{uiText("Đoạn chat đã lưu")}</strong>
        <span>{uiText("Tự động lưu sau khi gửi tin nhắn")}</span>
      </div>
      {archiveError && (
        <p className="ai-tutor-archive-error" role="alert">
          {uiText(archiveError)}
        </p>
      )}
      {archivePending && (
        <p className="ai-tutor-archive-note" role="status">
          {uiText("Đang tải đoạn chat…")}
        </p>
      )}
      {!archivePending && !archiveError && savedConversations.length === 0 && (
        <p className="ai-tutor-archive-note">
          {uiText("Chưa có đoạn chat nào. Hãy gửi tin nhắn đầu tiên để lưu lại.")}
        </p>
      )}
      <div className="ai-tutor-archive-list">
        {savedConversations.map((conversation) => (
          <button
            key={conversation.conversationId}
            type="button"
            className={conversationId === conversation.conversationId ? "is-current" : ""}
            disabled={pending}
            onClick={() => void openSavedConversation(conversation.conversationId)}
          >
            <span className="ai-tutor-archive-title">
              {conversation.title || uiText("Đoạn chat chưa đặt tên")}
            </span>
            <time dateTime={conversation.updatedAt}>{updatedLabel(conversation.updatedAt, locale)}</time>
          </button>
        ))}
      </div>
    </aside>
  );
}
