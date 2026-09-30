import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../auth/session";
import { AiTutorConversationProvider } from "../student/aiTutorConversation";
import { FloatingAiTutor } from "./FloatingAiTutor";
import { SafeMascot } from "./SafeMascot";

export function RoleAiExperience({ children }: { children: ReactNode }) {
  const { state, profile } = useSession();
  if (!profile || (state !== "AUTHENTICATED" && state !== "REFRESHING")) return <>{children}</>;

  if (profile.role === "STUDENT") {
    return (
      <AiTutorConversationProvider key={profile.userId}>
        <FloatingAiTutor />
        {children}
      </AiTutorConversationProvider>
    );
  }

  const destination =
    profile.role === "ADMIN"
      ? { path: "/app/admin/ai", label: "Mở AI quản trị", description: "Hỗ trợ quản trị AILSS" }
      : profile.lecturerVerified
        ? { path: "/app/teaching/ai", label: "Mở trợ lý soạn bài AI", description: "Soạn và rà soát câu hỏi" }
        : null;

  return (
    <>
      {destination && (
        <div className="floating-ai-tutor-root floating-ai-role-shortcut">
          <Link
            className="floating-ai-launcher"
            to={destination.path}
            aria-label={destination.label}
            title={destination.description}
          >
            <span className="floating-ai-role-label">{destination.description}</span>
            <span className="floating-ai-mascot-pod" aria-hidden="true">
              <SafeMascot
                directions="/mascots/tv-directions.webp"
                reactions="/mascots/tv-reactions.webp"
                size={68}
                label="AILSS AI"
              />
            </span>
          </Link>
        </div>
      )}
      {children}
    </>
  );
}
