# Quy Tắc Làm Việc (Development Workflow)

## 1. Phân Phối Nhánh (Branch Strategy)
- **`main`**: Nhánh chính, chỉ chứa bản phát hành ổn định (Production-ready) và tài liệu.
- **`dev`**: Nhánh phát triển chính, tích hợp và kiểm thử các tính năng mới.
- **`feature/<tên-tính-năng>`**: Nhánh nhánh con dùng để phát triển riêng từng chức năng.

## 2. Quy Chuẩn Commit (Conventional Commits)
- `feat:` Thêm tính năng mới.
- `fix:` Sửa lỗi.
- `docs:` Cập nhật tài liệu (`README.md`, `CONTRIBUTING.md`...).
- `refactor:` Cải thiện cấu trúc code nhưng không thay đổi logic.

## 3. Quy Trình Merge Code
1. Không `git push` trực tiếp code thử nghiệm lên `main`.
2. Mọi tính năng phải được test đạt yêu cầu trên `dev` trước khi gộp vào `main`.
3. Tạo Pull Request (PR) từ `dev` sang `main` để kiểm tra lại code trước khi gộp.
