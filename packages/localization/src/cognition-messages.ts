export const COGNITION_MESSAGES: Record<string, string> = {
  "Nhận biết": "Remember",
  "Thông hiểu": "Understand",
  "Vận dụng": "Apply",
  "Vận dụng cao": "Advanced application",
  "Nhớ khái niệm, định nghĩa và dữ kiện.": "Recall concepts, definitions and facts.",
  "Giải thích, so sánh và diễn giải kiến thức.": "Explain, compare and interpret knowledge.",
  "Áp dụng kiến thức vào tình huống cụ thể.": "Apply knowledge to specific situations.",
  "Phân tích nhiều bước, kết hợp kiến thức để giải quyết vấn đề.":
    "Analyze multiple steps and combine knowledge to solve problems.",
  "Đang xếp yêu cầu": "Request queued",
  "AI đang tạo câu hỏi": "AI is generating questions",
  "Đang kiểm tra cấu trúc câu hỏi": "Validating question structure",
  "Bản nháp đã sẵn sàng": "Draft ready",
  "Không thể tạo bản nháp": "Cannot generate draft",
  "Đã được giảng viên phê duyệt": "Approved by lecturer",
  "Đang chuẩn bị tải lên": "Preparing upload",
  "Đang chờ xử lý nội dung": "Content processing queued",
  "Đang xử lý nội dung": "Processing content",
  "Sẵn sàng sử dụng": "Ready to use",
  "Tài liệu không thể sử dụng": "Document cannot be used",
  "Không thể xử lý tài liệu này. Hãy thử tải lại hoặc chọn tài liệu khác.":
    "Cannot process this document. Upload it again or choose another document.",
  "Chưa thể tạo bản nháp. Bạn hãy thử lại sau.": "Cannot generate the draft right now. Try again later.",
  "Không thể tạo bản nháp do dịch vụ AI gặp lỗi. Hãy quay lại và tạo một yêu cầu mới.":
    "Draft generation failed due to an AI service error. Go back and create a new request.",
  "Tài liệu DOCX vượt giới hạn xử lý an toàn. Nếu đây là tệp thông thường, hãy lưu lại bằng Word rồi tải lại.":
    "The DOCX exceeds safe processing limits. If it is a normal document, save it again in Word and upload it again.",
  "Tài liệu có macro, nội dung nhúng hoặc điều khiển chủ động nên không thể sử dụng.":
    "Documents containing macros, embedded content or active controls cannot be used.",
  "Nội dung tệp không đúng định dạng DOCX.": "File content is not valid DOCX.",
  "Tệp DOCX bị lỗi hoặc thiếu dữ liệu cần thiết.": "The DOCX is malformed or missing required data.",
  "Tệp nhận được không khớp với tệp đã chọn. Hãy tải lại.":
    "The received file does not match the selected file. Upload it again.",
  "Nội dung tệp không khớp với định dạng đã chọn.": "File content does not match the selected format.",
  "Yêu cầu cũ không hoàn thành. Hệ thống chưa lưu nguyên nhân chi tiết cho yêu cầu này. Hãy tạo yêu cầu mới.":
    "The previous request did not complete. No detailed reason was saved. Create a new request.",
  "Dịch vụ AI tạm thời không sẵn sàng. Hệ thống đã thử tối đa 3 lần. Bạn có thể tạo lại yêu cầu sau; không cần tải lại tài liệu.":
    "The AI service is temporarily unavailable after up to three attempts. Retry later; you do not need to upload the document again.",
  "Dịch vụ AI đang giới hạn số yêu cầu hoặc hạn mức sử dụng. Hệ thống đã thử tối đa 3 lần. Hãy chờ rồi thử lại hoặc liên hệ quản trị viên kiểm tra hạn mức.":
    "The AI service is limiting requests or usage after up to three attempts. Wait and retry, or ask an administrator to check quotas.",
  "Dịch vụ AI phản hồi quá lâu. Hệ thống đã thử tối đa 3 lần. Hãy thử lại sau hoặc giảm số câu hỏi.":
    "The AI service timed out after up to three attempts. Retry later or request fewer questions.",
  "Không tìm thấy model hoặc tài nguyên AI đã cấu hình (404). Quản trị viên cần kiểm tra tên model và địa chỉ API.":
    "The configured AI model or resource was not found (404). An administrator should check the model name and API URL.",
  "Dịch vụ AI từ chối quyền truy cập. Quản trị viên cần kiểm tra API key và quyền của dự án.":
    "The AI service denied access. An administrator should check the API key and project permissions.",
  "Dịch vụ AI không chấp nhận cấu hình yêu cầu. Quản trị viên cần kiểm tra tham số của model.":
    "The AI service rejected the request configuration. An administrator should check the model parameters.",
  "AI trả về dữ liệu không đọc được hoặc không đúng định dạng JSON. Hãy tạo lại yêu cầu hoặc giảm số câu hỏi.":
    "AI returned unreadable data or invalid JSON. Retry the request or reduce the question count.",
  "Không thể đọc tài liệu hoặc lưu kết quả AI. Hãy thử lại; nếu vẫn lỗi, liên hệ quản trị viên kiểm tra kho lưu trữ.":
    "Cannot read the document or save AI results. Retry; if the problem persists, ask an administrator to check storage.",
  "Nội dung AI trả về chưa đáp ứng cấu trúc bài kiểm tra. Hãy tạo lại yêu cầu hoặc giảm số câu trong một lần tạo.":
    "AI output does not match the assessment structure. Retry or generate fewer questions at once.",
  "Chọn tệp PDF, DOCX hoặc TXT có dung lượng không quá 25 MiB.":
    "Choose a PDF, DOCX or TXT file up to 25 MiB.",
  "Đang tải tài liệu": "Uploading document",
  "Tài liệu đã tải lên. Hệ thống đang xử lý nội dung.": "Document uploaded. Content processing is underway.",
  "Tài liệu vẫn đang được xử lý.": "The document is still being processed.",
  "Tổng số câu phải từ 1 đến 50; số câu mỗi mức phải là số nguyên không âm.":
    "The total must be 1–50 questions; each level requires a nonnegative integer count.",
  "Chọn ít nhất một loại câu hỏi.": "Select at least one question type.",
  "Số câu cần ít nhất bằng số loại câu hỏi đã chọn.":
    "The question count must be at least the number of selected question types.",
  "Yêu cầu đã được tạo. AI sẽ chuẩn bị một bản nháp để bạn xem lại.":
    "Request created. AI will prepare a draft for your review.",
  "Đã cập nhật trạng thái từ máy chủ.": "Status updated from the server.",
  "Hãy sửa các lỗi trước khi phê duyệt.": "Fix the errors before approving.",
  "365 ngày": "365 days",
  "Dưới 5": "Below 5",
  "5–<6,5": "5–<6.5",
  "6,5–<8": "6.5–<8",
  "Thang 10": "10-point scale",
  "Lớp: {0}": "Class: {0}",
  "Quản trị viên (ADMIN)": "Administrator (ADMIN)",
  "Giảng viên (LECTURER)": "Lecturer (LECTURER)",
  "Học viên (STUDENT)": "Student (STUDENT)",
  "Tắt âm thanh": "Mute",
  "Đang phát": "Playing",
  "Robot Gia sư AI đang trả lời": "AI tutor robot is responding",
  "Robot Gia sư AI": "AI tutor robot",
};
