import { RoleAssistantChat } from "../../../src/RoleAssistantChat";

export default function LecturerCopilotScreen() {
  return (
    <RoleAssistantChat
      role="LECTURER"
      mode="LECTURER_COPILOT"
      title="Trợ lý AI giảng viên"
      subtitle="Hỗ trợ soạn bài và tổ chức giảng dạy"
      back="/teaching"
    />
  );
}
