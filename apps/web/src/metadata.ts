export const pages: Record<string, [string, string]> = {
  "/": [
    "Học tập thông minh hơn",
    "Khóa học, lớp học, đánh giá, tiến độ và AI tạo bản nháp câu hỏi có giảng viên duyệt.",
  ],
  "/about": ["Về AILSS", "Sứ mệnh, triết lý công nghệ, hành trình dự án và nhận diện NVD."],
  "/features": ["Tính năng nền tảng", "Khám phá các khả năng học tập, giảng dạy, AI và bảo mật của AILSS."],
  "/how-it-works": ["Cách AILSS hoạt động", "Hai hành trình rõ ràng cho sinh viên và giảng viên."],
  "/courses": ["Khám phá khóa học", "Tìm kiếm khóa học đã xuất bản trong danh mục AILSS."],
  "/ai-learning": ["AI Learning", "Từ tài liệu riêng tư đến bản nháp câu hỏi được giảng viên phê duyệt."],
  "/ai-quiz": ["Minh họa tạo quiz AI", "Thử rà soát và phê duyệt câu hỏi trong minh họa cục bộ."],
  "/students": ["Trải nghiệm sinh viên", "Khám phá, học tập, đánh giá, tương tác và theo dõi tiến độ."],
  "/lecturers": ["Trải nghiệm giảng viên", "Tổ chức học liệu, lớp học và quy trình duyệt câu hỏi AI."],
  "/classroom": ["Trải nghiệm lớp học", "Thành viên, lịch, phiên học và điểm danh có tổ chức."],
  "/assessment": ["Đánh giá học tập", "Quiz, lượt làm bài, chấm khách quan và kết quả."],
  "/progress": ["Tiến độ học tập", "Theo dõi bài học hoàn thành và tiến độ theo khóa học."],
  "/notifications": ["Thông báo trong ứng dụng", "Cập nhật lớp học với trạng thái chưa đọc và đã đọc."],
  "/security": ["Bảo mật AILSS", "Tìm hiểu cơ chế xác thực, phân quyền và bảo vệ học liệu đã triển khai."],
  "/architecture": ["Kiến trúc hệ thống", "Khám phá sáu business services cùng hạ tầng hỗ trợ AILSS."],
  "/research": [
    "Nghiên cứu hệ thống phân tán",
    "Cassandra-first, truy vấn có mục đích và xử lý bất đồng bộ.",
  ],
  "/roadmap": ["Lộ trình sản phẩm", "Phân biệt khả năng đã triển khai và hướng phát triển tiếp theo."],
  "/media": ["Thư viện hình ảnh", "Nhận diện NVD, hình ảnh minh họa và video câu chuyện sản phẩm."],
  "/faq": ["Câu hỏi thường gặp", "Câu trả lời về tài khoản, khóa học, AI và quyền riêng tư."],
  "/help": ["Trung tâm trợ giúp", "Hướng dẫn bắt đầu và xử lý vấn đề khi sử dụng AILSS."],
  "/contact": ["Liên hệ AILSS", "Chuẩn bị trao đổi hỗ trợ, dự án và nghiên cứu với bản nháp liên hệ."],
  "/auth/register/student": ["Đăng ký học viên", "Bắt đầu hành trình học tập cùng AILSS."],
  "/auth/register/lecturer": [
    "Tham gia với vai trò giảng viên",
    "Thông tin cấp và xác minh tài khoản giảng viên AILSS.",
  ],
  "/auth/register/lecturer/application": [
    "Gửi yêu cầu giảng dạy",
    "Sinh viên gửi và xem lại yêu cầu chuyển sang vai trò giảng viên AILSS.",
  ],
  "/auth/register/lecturer/status": [
    "Trạng thái yêu cầu giảng dạy",
    "Theo dõi trạng thái yêu cầu chuyển sang vai trò giảng viên AILSS.",
  ],
  "/auth/login": ["Đăng nhập", "Đăng nhập tài khoản AILSS bằng email và mật khẩu."],
  "/auth/register": ["Tạo tài khoản", "Đăng ký tài khoản sinh viên để bắt đầu cùng AILSS."],
  "/auth/forgot-password": [
    "Trợ giúp quên mật khẩu",
    "Tìm hiểu các bước khi bạn không thể đăng nhập tài khoản.",
  ],
  "/legal/privacy": [
    "Quyền riêng tư",
    "Cách public web AILSS xử lý thông tin trong bản triển khai hiện tại.",
  ],
  "/legal/terms": ["Thông tin sử dụng", "Phạm vi sử dụng public web, học liệu và nội dung AI."],
  "/legal/cookies": ["Chính sách cookie", "Thông tin về cookie và lưu trữ trình duyệt của public web."],
  "/accessibility": ["Khả năng tiếp cận", "Điều hướng bàn phím, giảm chuyển động và các lựa chọn truy cập."],
};
export function metadata(path: string) {
  if (path === "/app/schedule") return ["Lịch học", "Lịch học theo danh sách, tuần và tháng."];
  if (path === "/app/attendance") return ["Thông tin điểm danh", "Tổng hợp và chi tiết điểm danh theo lớp."];
  if (path === "/app/teaching/schedule") return ["Lịch dạy", "Theo dõi lịch giảng dạy theo lớp."];
  if (path === "/app/teaching/attendance") return ["Điểm danh lớp học", "Quản lý điểm danh các buổi học."];
  if (path.startsWith("/app/admin")) return ["Quản trị", "Quản lý người dùng, khóa học và nội dung AILSS."];
  if (path.startsWith("/app/teaching")) return ["Giảng dạy", "Khóa học và lớp học của bạn."];
  if (path.startsWith("/app/learn")) return ["Học tập", "Tiếp tục hành trình học tập của bạn."];
  if (path.startsWith("/app/") && path !== "/app/account")
    return ["Không gian học tập", "Lớp học, bài kiểm tra và tiến độ của bạn."];
  if (path === "/auth/register/student")
    return ["Đăng ký học viên", "Bắt đầu hành trình học tập cùng AILSS."];
  if (path === "/auth/register/lecturer")
    return ["Tham gia với vai trò giảng viên", "Thông tin cấp và xác minh tài khoản giảng viên AILSS."];
  if (path === "/app" || path === "/app/account")
    return [path === "/app" ? "Không gian cá nhân" : "Hồ sơ & bảo mật", "Quản lý tài khoản AILSS của bạn."];
  return (
    pages[path] ??
    (path.startsWith("/courses/")
      ? ["Thông tin khóa học", "Chi tiết khóa học công khai trong AILSS."]
      : ["Không tìm thấy trang", "Trang bạn tìm hiện không có trong AILSS."])
  );
}
