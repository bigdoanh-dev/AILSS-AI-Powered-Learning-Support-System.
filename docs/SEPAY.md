# Thanh toán tự động SePay

## Mô hình B — quyết định P12.9R

Xem ADR-P12-9R-PAYMENT-MODE-B.md. `PAYMENT_MODE=simulation` chỉ dành cho profile dev hoặc test; `PAYMENT_MODE=sepay` mới nhận callback và cung cấp QR. Không suy luận chế độ từ sự hiện diện của khóa. Runtime SePay không cho gọi simulate-payment. Không đổi chế độ trên dữ liệu có đơn đang chờ; cần hoàn tất/đối soát đơn trước.

## Cấu hình

1. Chọn `PAYMENT_MODE=sepay`. Điền `SEPAY_WEBHOOK_API_KEY` (ít nhất 32 ký tự ngẫu nhiên), `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME`, `SEPAY_BANK` vào môi trường learning-service / `.env` Docker Compose. Mã ngân hàng theo SePay QR. Không đưa API key vào Vite hoặc mã nguồn.
2. Chạy bootstrap Cassandra hiện có (`node scripts/dev/bootstrap-cassandra.mjs`) để áp dụng migration `026_learning_sepay.cql` theo profile dev/research, rồi build và khởi động lại gateway, learning-service, web. Quyền SELECT/MODIFY của svc_learning phải áp dụng cho hai bảng mới.
3. Trên SePay, tạo webhook tiền vào, JSON, URL HTTPS công khai trỏ tới API gateway: `/api/v1/payments/sepay/webhook`. Chọn xác thực **API Key** và dùng cùng khóa ở bước 1. Header: `Authorization: Apikey <key>`.
4. Giữ cơ chế retry khi HTTP không thành công. Đảm bảo cấu hình nhận giao dịch có nội dung `AILSS` + 32 ký tự mã đơn (không dấu gạch). Không bật bộ lọc mã thanh toán khác làm bỏ qua nội dung này.
5. Kiểm tra bằng một đơn VND nhỏ và giao dịch thật/sandbox của SePay. Trình duyệt phải chuyển từ chờ thanh toán → đang cấp quyền → thành công. RabbitMQ và consumer cấp quyền của learning-service phải hoạt động.

## Hành vi

- Backend cung cấp QR và thông tin chuyển khoản từ giá lưu trong đơn. Frontend thăm dò đơn mỗi 1,5 giây, lưu mã đơn vào URL để tải lại được.
- Chỉ tiền vào đúng tài khoản, đúng một mã đơn và đúng số tiền VND nguyên mới được xử lý. Không tự xác nhận từ trình duyệt. Endpoint mô phỏng chỉ hoạt động khi chọn tường minh simulation trong dev/test.
- Bảng `sepay_transaction_by_id` giữ giao dịch vĩnh viễn (không TTL); `sepay_payment_by_order` chọn khoản thanh toán đầu tiên bằng Cassandra LWT. Retry dùng cùng thời điểm và event id để khôi phục sau lỗi giữa các bước.
- Sai tiền, đơn thất bại hoặc chuyển thêm lần nữa trả lỗi để vào luồng kiểm tra/retry của SePay. Nhân viên cần kiểm tra giao dịch lỗi trên SePay và xử lý/hoàn khoản dư thủ công; chưa có màn hình đối soát hoặc API hoàn tiền tự động.
- Tiền ra, sai tài khoản, sai tiền hoặc đơn không xác định bị từ chối bằng lỗi PAYMENT_REJECTED chung, không sửa Order.
- Không kết luận thất bại chỉ vì người dùng đóng trang hoặc ngân hàng thông báo chậm. Nếu cấp quyền lớp học không thể hoàn tất, hiển thị cần hỗ trợ và không yêu cầu chuyển lại.
- Trang kết quả có animation SVG/CSS dùng cho thanh toán, đăng ký, đăng nhập/đăng xuất, đổi mật khẩu, cập nhật tên/ảnh đại diện, tham gia lớp và đăng ký khóa học miễn phí. Kết quả giữ trên màn hình đến khi người dùng bấm tiếp tục để đọc phản hồi, sao chép mã đơn hoặc xử lý lỗi; không tự gửi lại thao tác. Tôn trọng prefers-reduced-motion; thao tác nhỏ của học viên dùng thông báo animation ngay trong trang.

Tài liệu chính thức: https://developer.sepay.vn/sepay-webhooks/tich-hop-webhook

Chưa có cấu hình ngân hàng/khóa/URL công khai thì chưa thể chạy kiểm thử thanh toán thật. Không đưa các giá trị bí mật vào báo cáo hoặc commit.
