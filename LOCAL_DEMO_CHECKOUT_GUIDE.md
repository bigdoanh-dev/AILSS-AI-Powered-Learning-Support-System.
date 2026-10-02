# Thử đăng ký và thanh toán khóa học ở local

## Dữ liệu demo và quyền học

Các script tạo danh mục dưới đây mặc định **không đăng ký, mô phỏng thanh toán hoặc cấp quyền học** cho học viên demo:

- `scripts/dev/seed-web-demo.mjs`
- `scripts/dev/seed-featured-instructors.mjs`
- `scripts/dev/import-owned-courses.mjs`

Nếu cần bộ dữ liệu học viên đã mua để thử nội dung, chạy script với `AILSS_DEMO_ENROLL_STUDENT=true`. Đây là lựa chọn chủ động và sử dụng thanh toán mô phỏng; không dùng để kiểm tra giao dịch ngân hàng thật. Endpoint mô phỏng bị chặn khi `PAYMENT_MODE=sepay`.

## Gỡ quyền được seed sẵn để thử mua từ đầu

Chạy ở thư mục gốc repo khi Gateway local và Learning đang hoạt động:

```sh
# Xem trước; chưa thay đổi dữ liệu.
node scripts/dev/reset-demo-course-access.mjs

# Lưu bản sao rồi gỡ quyền demo đủ điều kiện.
node scripts/dev/reset-demo-course-access.mjs --apply
```

Công cụ chỉ xử lý tài khoản `student.demo@ailss.local`, tám khóa có slug fixture xác định, và đăng ký SELF_PACED có đơn demo đã hoàn tất. Công cụ từ chối dữ liệu có giao dịch SePay thật, đơn không phải demo hoặc đăng ký legacy cần đối chiếu riêng. Có thể đặt `AILSS_GATEWAY_URL` tới địa chỉ HTTP loopback khác và `AILSS_DEMO_STUDENT_PASSWORD` nếu đổi mật khẩu demo.

Bản sao các bản ghi bị gỡ nằm trong `tmp/demo-access-reset/` ở máy local, không đưa lên Git. Giữ bản sao nếu cần khôi phục. Khóa học, tài khoản, bài giảng và đơn demo lịch sử được giữ lại; đơn cũ là dữ liệu mô phỏng và không còn cấp quyền học sau reset.

## Kiểm tra trên web và mobile

1. Tải lại danh mục; trên mobile rời màn hình rồi mở lại hoặc Reload Expo Go.
2. Khóa miễn phí chưa đăng ký phải hiện **Đăng ký miễn phí**. Khóa có học phí phải hiện **Xem gói & mua** trên mobile và thao tác mua trên web.
3. Chưa đăng ký: API tiến độ/nội dung riêng tư trả `403 COURSE_ACCESS_DENIED`; bài được giảng viên cho xem trước vẫn có thể xem.
4. Đăng ký khóa miễn phí cấp quyền sau khi backend hoàn tất ghi danh, không cần chuyển tiền.
5. Đơn trả phí mới ở trạng thái PENDING không cấp quyền. Chỉ giao dịch được backend xác nhận và cấp entitlement thành công mới cho phép học.
6. `/api/v1/me/courses` chỉ trả khóa có entitlement ACTIVE hiện tại. Bản chiếu đăng ký cũ không đủ để hiển thị “Đã có quyền học”.

Để kiểm tra thanh toán từ đầu, tạo đơn mới; không dùng lại mã đơn demo đã mô phỏng thành công. Khi dùng tài khoản học viên mới, không chạy script tạo dữ liệu học viên trên tài khoản đó.
