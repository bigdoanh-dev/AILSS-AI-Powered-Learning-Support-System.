import { RoleAssistantChat } from "../../../src/RoleAssistantChat";

export default function AdminAiScreen() {
  return (
    <RoleAssistantChat
      role="ADMIN"
      mode="ADMIN_SUPPORT"
      title="AI quản trị"
      subtitle="Hỗ trợ quy trình, báo cáo và vận hành"
      back="/admin"
    />
  );
}
