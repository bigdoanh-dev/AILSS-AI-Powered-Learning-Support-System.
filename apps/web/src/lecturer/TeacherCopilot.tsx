import { Link } from "react-router-dom";
export function TeacherCopilotPage() {
  return (
    <section className="study-card">
      <h1>Trợ lý giảng viên</h1>
      <p>Chưa có dữ liệu cảnh báo sớm được tổng hợp cho tài khoản này.</p>
      <Link to="/app/teaching/ai">Soạn nội dung với AI</Link>
      <Link to="/app/teaching/classes">Quản lý và cảnh báo học viên trong lớp</Link>
    </section>
  );
}
