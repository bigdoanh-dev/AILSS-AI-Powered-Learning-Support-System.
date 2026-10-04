import type { AssistantLlmProvider, LlmCompletionRequest, LlmCompletionResponse } from "./llm-provider.js";

/** Explicit local guidance for ADMIN_SUPPORT; other modes keep their configured provider. */
export class LocalAdminGuideProvider implements AssistantLlmProvider {
  public constructor(private readonly provider: AssistantLlmProvider) {}

  public generate(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (request.integrationContext?.mode !== "ADMIN_SUPPORT") return this.provider.generate(request);
    const question =
      [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const normalized = question.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const english = request.integrationContext.responseLanguage === "en";
    let guidance: string;
    if (/sepay|webhook|thanh toan|doi soat|payment|reconcil/u.test(normalized)) {
      guidance = english
        ? "View Revenue at /app/admin/revenue and Logs at /app/admin/logs. For local SePay webhook checks, compare SePay delivery history with learning-service and api-gateway logs. Webhooks need a public URL forwarded to Gateway; SePay cannot reach 127.0.0.1. Only verified, reconciled transactions count. System logs do not replace SePay delivery history."
        : "Xem Doanh thu tại /app/admin/revenue và Nhật ký tại /app/admin/logs. Để kiểm tra webhook SePay trên local, đối chiếu lịch sử gửi webhook trong SePay với log learning-service và api-gateway. Webhook cần URL public chuyển tiếp tới Gateway; 127.0.0.1 không nhận được yêu cầu từ SePay. Chỉ giao dịch đã xác thực và đối soát mới được tính; màn hình Nhật ký không thay thế lịch sử gửi webhook của SePay.";
    } else if (/giang vien|ho so|xet duyet|xac minh|lecturer|instructor|verif/u.test(normalized)) {
      guidance = english
        ? "Open Lecturer Applications at /app/admin/lecturer-applications, select an application, and review the submitted information. Verify it before approving or rejecting. Check the result on the application; this guide does not review applications for you."
        : "Mở Hồ sơ giảng viên tại /app/admin/lecturer-applications, chọn hồ sơ và xem thông tin đã gửi. Đối chiếu thông tin trước khi duyệt hoặc từ chối. Kiểm tra kết quả trên hồ sơ tương ứng; hướng dẫn này không thực hiện xét duyệt giúp bạn.";
    } else if (/khoa hoc|xuat ban|phe duyet|course|publish/u.test(normalized)) {
      guidance = english
        ? "Lecturers create and submit courses for review. Administrators open /app/admin/courses, select a pending course, review its content, and confirm publication on that screen. Draft courses are not in the public catalog. This guide does not publish courses."
        : "Giảng viên tạo và gửi khóa học để duyệt. Quản trị viên mở /app/admin/courses, chọn khóa đang chờ duyệt, kiểm tra nội dung và xác nhận thao tác xuất bản trên màn hình. Khóa bản nháp chưa xuất hiện trong danh mục công khai. Hướng dẫn này không tự xuất bản khóa học.";
    } else if (/kiem duyet|bao cao|moderation|report/u.test(normalized)) {
      guidance = english
        ? "Open Moderation at /app/admin/moderation to view reports. Select a report and review its content and reason before acting. Actual counts and statuses are shown there; this guide does not read or resolve your reports."
        : "Mở Kiểm duyệt tại /app/admin/moderation để xem các báo cáo. Chọn báo cáo, kiểm tra nội dung và lý do trước khi xử lý. Số lượng và trạng thái thực tế nằm trên màn hình đó; hướng dẫn này không đọc hoặc xử lý báo cáo của bạn.";
    } else if (/prometheus|grafana|giam sat|dich vu|monitor|service/u.test(normalized)) {
      guidance = english
        ? "Open System Monitoring at /app/admin/monitoring. Locally, Prometheus is at http://127.0.0.1:9090 and Grafana at http://127.0.0.1:3001. Use Refresh to view metrics collected by Gateway. Docker must run with the observability configuration. See LOCAL_TO_VPS_CONFIGURATION.md for setup and VPS migration."
        : "Mở Giám sát hệ thống tại /app/admin/monitoring. Trên local, Prometheus ở http://127.0.0.1:9090, Grafana ở http://127.0.0.1:3001. Dùng nút Làm mới để xem số liệu được Gateway thu thập. Docker phải chạy cùng cấu hình observability; xem LOCAL_TO_VPS_CONFIGURATION.md để khởi động và chuyển sang VPS.";
    } else if (/thong ke|so lieu|hoc tap|statistic|analytic|learning/u.test(normalized)) {
      guidance = english
        ? "Open Learning & AI Statistics at /app/admin/stats. Metrics come from the system; this local guide does not read personal data or calculate metrics on behalf of that screen."
        : "Mở Thống kê học tập và AI tại /app/admin/stats. Số liệu hiển thị lấy từ hệ thống; hướng dẫn local không đọc dữ liệu cá nhân hoặc tính toán số liệu thay màn hình này.";
    } else {
      guidance = english
        ? "You can ask about moderation (/app/admin/moderation), lecturer applications (/app/admin/lecturer-applications), course publication (/app/admin/courses), revenue (/app/admin/revenue), logs (/app/admin/logs), or monitoring (/app/admin/monitoring). Questions outside these workflows require a configured AI provider."
        : "Bạn có thể hỏi về kiểm duyệt (/app/admin/moderation), hồ sơ giảng viên (/app/admin/lecturer-applications), xuất bản khóa học (/app/admin/courses), doanh thu (/app/admin/revenue), nhật ký (/app/admin/logs) hoặc giám sát (/app/admin/monitoring). Với câu hỏi ngoài các quy trình này, cần cấu hình nhà cung cấp AI thật.";
    }
    return Promise.resolve({
      content: `${english ? "Local guide — no online AI model is called." : "Hướng dẫn local — không gọi mô hình AI trực tuyến."}\n\n${guidance}`,
    });
  }
}
