import { useUiText } from "../../../src/use-language";
import { RoleAssistantChat } from "../../../src/RoleAssistantChat";

export default function LecturerCopilotScreen() {
  const uiText = useUiText();
  return (
    <RoleAssistantChat
      role="LECTURER"
      mode="LECTURER_COPILOT"
      title={uiText("Trợ lý AI giảng viên")}
      subtitle={uiText("Hỗ trợ soạn bài và tổ chức giảng dạy")}
      back="/teaching"
    />
  );
}
