# Dữ liệu demo liên kết cho web và mobile

## Tài khoản và quan hệ dữ liệu

| Đối tượng                           | Email                           | Dữ liệu để kiểm tra                                                                            |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Học viên chính                      | `student.demo@ailss.local`      | Tham gia các lớp Web, Cassandra và Python; xem cùng lịch/đề/kết quả mà giảng viên quản lý      |
| Giảng viên chính                    | `lecturer.demo@ailss.local`     | Tái sử dụng lớp Web Fullstack K26 và lớp chuyên đề Cassandra đang có học viên chính            |
| Giảng viên thứ hai — Minh An        | `an.python.demo@ailss.local`    | Một lớp `[Demo liên kết] Python thực hành - Minh An`, 3 buổi học và 1 đề Python                |
| Học viên phụ để đối chiếu bảng điểm | `nam.hoang.student@ailss.local` | Tái sử dụng tài khoản đã có; tham gia lớp Python, nộp một bài để giảng viên thứ hai có kết quả |

Không tạo thêm tài khoản hoặc khóa học. Dữ liệu này chỉ phục vụ local. Bài nộp demo là câu trả lời được gửi qua API và chấm bằng backend; không ghi trực tiếp điểm/GPA/chuỗi học tập hay doanh thu. Phản hồi có nhãn `[Dữ liệu demo]` và giữ điểm đã chấm tự động.

## Chạy trên local

Khởi động Gateway, Identity, Learning, Classroom và Assessment của profile `dev-async`. Các tài khoản, hai lớp cũ và khóa `instructor-demo-1` phải đã tồn tại. Script dừng nếu thiếu dữ liệu hoặc sai chủ sở hữu; không chọn bừa một lớp/khóa khác.

```sh
pnpm seed:lecturer-demo
pnpm seed:lecturer-demo --verify
node --test scripts/dev/linked-demo-plan.test.mjs
```

Gateway mặc định là `http://127.0.0.1:8080`. Chỉ chấp nhận HTTP loopback và profile `dev-async`, không dùng script này trên VPS. Nếu thay đổi mật khẩu demo, cung cấp các biến `AILSS_DEMO_STUDENT_PASSWORD`, `AILSS_DEMO_LECTURER_PASSWORD`, `AILSS_DEMO_SECOND_LECTURER_PASSWORD` và `AILSS_DEMO_AUX_STUDENT_PASSWORD` qua môi trường local.

Nhật ký chạy nằm trong `tmp/linked-demo/` (được Git bỏ qua), không lưu mật khẩu hoặc token. Giữ nhật ký để chạy lại không tạo trùng lớp, lịch, đề và bài nộp. Lịch Python lấy ngày chạy đầu tiên làm mốc, chọn 3 buổi 09:00–10:30 giờ Việt Nam và tránh lịch đã có của hai học viên. Lịch được xuất bản trước khi học viên nhập mã tham gia. Mã tham gia chỉ được lấy khi cần thêm thành viên, không ghi vào nhật ký.

`--verify` chỉ đọc dữ liệu sau đăng nhập: kiểm tra thành viên hai phía, lịch học trùng lịch lớp, đề hiển thị cho học viên, không lộ đáp án, kết quả học viên khớp bảng điểm và giảng viên không xem được bảng điểm của người khác.

Backend loại bản ghi danh sách lặp cùng ID và kiểm tra chủ sở hữu từ dữ liệu lớp gốc. Khi xuất bản lịch, chỉ mục lớp của giảng viên được chuyển sang ngày cập nhật mới; nhờ đó việc đổi mã tham gia sau này không để lại một dòng lớp cũ. Thay đổi này dùng chung cho web/mobile.

## Kiểm tra giao diện

1. Học viên chính: mở **Lớp học**, **Lịch học**, **Bài kiểm tra**, **Bảng điểm** trên web/mobile. Lớp Python có 3 buổi và đề mới để tự làm; script không tự tạo bài nộp Python cho học viên chính.
2. Giảng viên chính: mở lớp Web/Cassandra, danh sách học viên, đề và bảng điểm. Kết quả Cassandra đã có được giữ lại, không tự nộp thêm lần mới.
3. Giảng viên Minh An: mở lớp Python, kiểm tra học viên chính và Nam, 3 buổi học, đề và kết quả của Nam.
4. Đăng nhập một tài khoản mới không thuộc demo: không tự nhận lớp/điểm hoặc bài tập mẫu. Mobile hiển thị đề lấy từ backend, không dùng bài tập/đề giả khi danh sách rỗng.
5. Trong Expo Go, tải lại ứng dụng để lấy giao diện mới rồi đăng nhập từng tài khoản bằng email.

Việc tham gia lớp demo không tự mua các khóa học trong danh mục. Script so sánh danh sách quyền học trước/sau; các khóa chưa mua vẫn phải đăng ký/thanh toán. Không tạo giao dịch SePay, doanh thu, cảnh báo kỷ luật hoặc điểm danh giả. Buổi Cassandra đã kết thúc trước khi học viên tham gia không được tự đánh dấu có mặt.

Các lớp kiểm thử cũ khác vẫn có thể xuất hiện trên tài khoản demo. Script chỉ tái sử dụng hai lớp đã chọn và thêm một lớp Python; không xóa dữ liệu cũ của người dùng.
