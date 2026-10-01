import { Link } from "react-router-dom";
import { useSession } from "../auth/session";
import { StudyPlanPage } from "./StudyPlan";
export interface StudentWorkspaceProps {
  studentName?: string;
  studentId?: string;
  tenantId?: string;
}
export function UnifiedStudentWorkspace() {
  const { profile } = useSession();
  return (
    <>
      <h1>Không gian học tập cá nhân</h1>
      <p>Xin chào {profile?.displayName}.</p>
      <div className="workspace-quick-actions">
        <Link to="/app/progress" className="quick-action-chip">
          Tiến độ học tập
        </Link>
        <Link to="/app/ai-tutor" className="quick-action-chip">
          Gia sư AI
        </Link>
      </div>
      <StudyPlanPage />
    </>
  );
}
