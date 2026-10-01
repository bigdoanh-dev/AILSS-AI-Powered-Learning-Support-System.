import type { AssistantLlmProvider, LlmCompletionRequest, LlmCompletionResponse } from "./llm-provider.js";

/** Explicit local guidance for ADMIN_SUPPORT; other modes keep their configured provider. */
export class LocalAdminGuideProvider implements AssistantLlmProvider {
  public constructor(private readonly provider: AssistantLlmProvider) {}

  public generate(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (request.integrationContext?.mode !== "ADMIN_SUPPORT") return this.provider.generate(request);
    const question =
      [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const normalized = question.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    let guidance: string;
    if (/sepay|webhook|thanh toan|doi soat/u.test(normalized)) {
      guidance =
        "Xem Doanh thu tại /app/admin/revenue và Nhật ký tại /app/admin/logs. Để kiểm tra webhook SePay trên local, đối chiếu lịch sử gửi webhook trong SePay với log learning-service và api-gateway. Webhook cần URL public chuyển tiếp tới Gateway; 127.0.0.1 không nhận được yêu cầu từ SePay. Chỉ giao dịch đã xác thực và đối soát mới được tính; màn hình Nhật ký không thay thế lịch sử gửi webhook của SePay.";
    } else if (/giang vien|ho so|xet duyet|xac minh/u.test(normalized)) {
      guidance =
        "Mở Hồ sơ giảng viên tại /app/admin/lecturer-applications, chọn hồ sơ và xem thông tin đã gửi. Đối chiếu thông tin trước khi duyệt hoặc từ chối. Kiểm tra kết quả trên hồ sơ tương ứng; hướng dẫn này không thực hiện xét duyệt giúp bạn.";
    } else if (/khoa hoc|xuat ban|phe duyet/u.test(normalized)) {
      guidance =
        "Giảng viên tạo và gửi khóa học để duyệt. Quản trị viên mở /app/admin/courses, chọn khóa đang chờ duyệt, kiểm tra nội dung và xác nhận thao tác xuất bản trên màn hình. Khóa bản nháp chưa xuất hiện trong danh mục công khai. Hướng dẫn này không tự xuất bản khóa học.";
    } else if (/kiem duyet|bao cao|moderation/u.test(normalized)) {
      guidance =
        "Mở Kiểm duyệt tại /app/admin/moderation để xem các báo cáo. Chọn báo cáo, kiểm tra nội dung và lý do trước khi xử lý. Số lượng và trạng thái thực tế nằm trên màn hình đó; hướng dẫn này không đọc hoặc xử lý báo cáo của bạn.";
    } else if (/prometheus|grafana|giam sat|dich vu/u.test(normalized)) {
      guidance =
        "Mở Giám sát hệ thống tại /app/admin/monitoring. Trên local, Prometheus ở http://127.0.0.1:9090, Grafana ở http://127.0.0.1:3001. Dùng nút Làm mới để xem số liệu được Gateway thu thập. Docker phải chạy cùng cấu hình observability; xem LOCAL_TO_VPS_CONFIGURATION.md để khởi động và chuyển sang VPS.";
    } else if (/thong ke|so lieu|hoc tap/u.test(normalized)) {
      guidance =
        "Mở Thống kê học tập và AI tại /app/admin/stats. Số liệu hiển thị lấy từ hệ thống; hướng dẫn local không đọc dữ liệu cá nhân hoặc tính toán số liệu thay màn hình này.";
    } else {
      guidance =
        "Bạn có thể hỏi về kiểm duyệt (/app/admin/moderation), hồ sơ giảng viên (/app/admin/lecturer-applications), xuất bản khóa học (/app/admin/courses), doanh thu (/app/admin/revenue), nhật ký (/app/admin/logs) hoặc giám sát (/app/admin/monitoring). Với câu hỏi ngoài các quy trình này, cần cấu hình nhà cung cấp AI thật.";
    }
    return Promise.resolve({ content: `Hướng dẫn local — không gọi mô hình AI trực tuyến.\n\n${guidance}` });
  }
}
