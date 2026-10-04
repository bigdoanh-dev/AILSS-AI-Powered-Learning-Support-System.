import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
export function TeacherCopilotPage() {
  const uiText = useUiText();
  return (
    <section className="study-card">
      <h1>{uiText("Trợ lý giảng viên")}</h1>
      <p>{uiText("Chưa có dữ liệu cảnh báo sớm được tổng hợp cho tài khoản này.")}</p>
      <Link to="/app/teaching/ai">{uiText("Soạn nội dung với AI")}</Link>
      <Link to="/app/teaching/classes">{uiText("Quản lý và cảnh báo học viên trong lớp")}</Link>
    </section>
  );
}
