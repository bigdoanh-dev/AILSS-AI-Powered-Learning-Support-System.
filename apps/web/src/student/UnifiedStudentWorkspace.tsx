import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
import { useSession } from "../auth/session";
import { StudyPlanPage } from "./StudyPlan";
export interface StudentWorkspaceProps {
  studentName?: string;
  studentId?: string;
  tenantId?: string;
}
export function UnifiedStudentWorkspace() {
  const uiText = useUiText();
  const { profile } = useSession();
  return (
    <>
      <h1>{uiText("Không gian học tập cá nhân")}</h1>
      <p>
        {uiText("Xin chào ")}
        {profile?.displayName}.
      </p>
      <div className="workspace-quick-actions">
        <Link to="/app/progress" className="quick-action-chip">
          {uiText("Tiến độ học tập")}
        </Link>
        <Link to="/app/ai-tutor" className="quick-action-chip">
          {uiText("Gia sư AI")}
        </Link>
      </div>
      <StudyPlanPage />
    </>
  );
}
