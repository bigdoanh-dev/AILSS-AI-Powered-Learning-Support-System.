import { useUiText } from "../../../src/use-language";
import { RoleAssistantChat } from "../../../src/RoleAssistantChat";

export default function AdminAiScreen() {
  const uiText = useUiText();
  return (
    <RoleAssistantChat
      role="ADMIN"
      mode="ADMIN_SUPPORT"
      title={uiText("AI quản trị")}
      subtitle={uiText("Hỗ trợ quy trình, báo cáo và vận hành")}
      back="/admin"
    />
  );
}
