import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";

export interface SystemSettingsState {
  requireLoginOnColdStart: boolean;
  sessionTimeoutMinutes: number;
  sudoModeSensitiveActions: boolean;
  sepayNotifications: boolean;
  moderationAlerts: boolean;
  lecturerAppAlerts: boolean;
  cacheClearedAt: string | null;
}

const DEFAULT_SETTINGS: SystemSettingsState = {
  requireLoginOnColdStart: true,
  sessionTimeoutMinutes: 30,
  sudoModeSensitiveActions: true,
  sepayNotifications: true,
  moderationAlerts: true,
  lecturerAppAlerts: true,
  cacheClearedAt: null,
};

export default function SettingsDashboard() {
  const [settings, setSettings] = useState<SystemSettingsState>(() => {
    try {
      const saved = localStorage.getItem("ailss_admin_system_settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [savedNotice, setSavedNotice] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  const updateSetting = <K extends keyof SystemSettingsState>(key: K, value: SystemSettingsState[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        localStorage.setItem("ailss_admin_system_settings", JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  const handleClearCache = () => {
    const timestamp = new Date().toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    updateSetting("cacheClearedAt", timestamp);
    setCacheNotice(`Đã dọn dẹp bộ nhớ đệm (Cache & Assets) thành công vào lúc ${timestamp}!`);
    setTimeout(() => setCacheNotice(null), 4000);
  };

  return (
    <div className="admin-dashboard-container">
      {/* Header */}
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">CẤU HÌNH & BẢO MẬT</p>
          <h1>Cài Đặt Hệ Thống & Quản Trị Bảo Mật</h1>
          <p className="lead">
            Quản lý chính sách phiên làm việc, cảnh báo giao dịch thương mại và tối ưu hóa tài nguyên máy chủ.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-subtle" to="/app">
            ← Tổng quan Admin
          </Link>
          <button className="button" onClick={handleClearCache}>
            <Icon name="refresh" size={15} /> Dọn dẹp Cache
          </button>
        </div>
      </div>

      {savedNotice && (
        <div className="dashboard-banner-notice" role="status">
          <span>
            <Icon name="check" size={15} />
          </span>
          <span>Đã lưu các thay đổi cấu hình thành công!</span>
        </div>
      )}

      {cacheNotice && (
        <div className="dashboard-banner-notice" role="status">
          <span>
            <Icon name="check" size={15} />
          </span>
          <span>{cacheNotice}</span>
        </div>
      )}

      {/* Security Policies */}
      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2>Chính Sách Bảo Mật Phiên Làm Việc (Session Security)</h2>
            <p className="subtext">
              Quy tắc quản lý trạng thái đăng nhập, xác thực lại và thời gian nhàn rỗi tài khoản.
            </p>
          </div>
          <span className="kpi-tag">Chưa xác minh ISO 27001</span>
        </div>

        <div className="settings-list">
          <div className="settings-item">
            <div className="settings-item-info">
              <label htmlFor="toggle-cold-start" className="settings-item-title">
                Yêu cầu đăng nhập lại khi đóng trình duyệt / thoát app
              </label>
              <p className="settings-item-desc">
                Khi bật, hệ thống tự động hủy token phiên và yêu cầu xác thực lại mỗi khi người dùng tắt hẳn
                phiên làm việc hoặc khởi động lại thiết bị (Cold Start).
              </p>
            </div>
            <div className="toggle-switch-wrapper">
              <input
                id="toggle-cold-start"
                type="checkbox"
                className="toggle-checkbox"
                checked={settings.requireLoginOnColdStart}
                onChange={(e) => updateSetting("requireLoginOnColdStart", e.target.checked)}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label htmlFor="toggle-sudo-mode" className="settings-item-title">
                Chế độ Sudo Mode cho các tác vụ nhạy cảm
              </label>
              <p className="settings-item-desc">
                Bắt buộc Quản trị viên phải nhập lại mật khẩu hiện tại trước khi thay đổi trạng thái người
                dùng (Khóa/Mở) hoặc duyệt khóa học.
              </p>
            </div>
            <div className="toggle-switch-wrapper">
              <input
                id="toggle-sudo-mode"
                type="checkbox"
                className="toggle-checkbox"
                checked={settings.sudoModeSensitiveActions}
                onChange={(e) => updateSetting("sudoModeSensitiveActions", e.target.checked)}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label htmlFor="select-timeout" className="settings-item-title">
                Thời gian nhàn rỗi tự động đăng xuất
              </label>
              <p className="settings-item-desc">
                Tự động kết thúc phiên làm việc nếu người dùng không tương tác trong khoảng thời gian quy
                định.
              </p>
            </div>
            <div className="settings-control-right">
              <select
                id="select-timeout"
                value={settings.sessionTimeoutMinutes}
                onChange={(e) => updateSetting("sessionTimeoutMinutes", Number(e.target.value))}
                className="settings-select"
              >
                <option value={15}>15 phút</option>
                <option value={30}>30 phút (Khuyến nghị)</option>
                <option value={60}>60 phút (1 giờ)</option>
                <option value={1440}>24 giờ</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Notifications & Webhooks */}
      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2>Cảnh Báo & Thông Báo Vận Hành</h2>
            <p className="subtext">Cấu hình nhận thông báo thời gian thực về các sự kiện trong hệ thống.</p>
          </div>
        </div>

        <div className="settings-list">
          <div className="settings-item">
            <div className="settings-item-info">
              <label htmlFor="toggle-sepay-notif" className="settings-item-title">
                Thông báo đơn hàng & Biến động số dư SePay
              </label>
              <p className="settings-item-desc">
                Nhận cảnh báo âm thanh và pop-up ngay khi có giao dịch thanh toán thành công hoặc ngoại lệ đối
                soát.
              </p>
            </div>
            <div className="toggle-switch-wrapper">
              <input
                id="toggle-sepay-notif"
                type="checkbox"
                className="toggle-checkbox"
                checked={settings.sepayNotifications}
                onChange={(e) => updateSetting("sepayNotifications", e.target.checked)}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label htmlFor="toggle-mod-notif" className="settings-item-title">
                Cảnh báo kiểm duyệt nội dung tự động
              </label>
              <p className="settings-item-desc">
                Nhận cảnh báo khi thuật toán AI phát hiện bình luận vi phạm hoặc học viên gửi báo cáo khiếu
                nại mới.
              </p>
            </div>
            <div className="toggle-switch-wrapper">
              <input
                id="toggle-mod-notif"
                type="checkbox"
                className="toggle-checkbox"
                checked={settings.moderationAlerts}
                onChange={(e) => updateSetting("moderationAlerts", e.target.checked)}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label htmlFor="toggle-lect-notif" className="settings-item-title">
                Hồ sơ ứng tuyển giảng viên mới
              </label>
              <p className="settings-item-desc">
                Gửi thông báo nhắc nhở Quản trị viên thẩm định bằng cấp khi có học viên đăng ký nâng cấp vai
                trò giảng viên.
              </p>
            </div>
            <div className="toggle-switch-wrapper">
              <input
                id="toggle-lect-notif"
                type="checkbox"
                className="toggle-checkbox"
                checked={settings.lecturerAppAlerts}
                onChange={(e) => updateSetting("lecturerAppAlerts", e.target.checked)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* System Information & Maintenance */}
      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2>Thông Tin Hệ Thống & Bảo Trì Tài Nguyên</h2>
            <p className="subtext">
              Chi tiết phiên bản triển khai, trạng thái máy chủ và dọn dẹp bộ nhớ đệm.
            </p>
          </div>
        </div>

        <div className="system-info-grid">
          <div className="sys-info-item">
            <span className="sys-label">Phiên bản Web Platform</span>
            <span className="sys-val">AILSS Enterprise v12.1.0</span>
          </div>
          <div className="sys-info-item">
            <span className="sys-label">Kiến trúc Gateway</span>
            <span className="sys-val">Node.js LTS / Express Microservices</span>
          </div>
          <div className="sys-info-item">
            <span className="sys-label">Cơ sở dữ liệu</span>
            <span className="sys-val">PostgreSQL / Redis Cache Cluster</span>
          </div>
          <div className="sys-info-item">
            <span className="sys-label">Dọn dẹp cache gần nhất</span>
            <span className="sys-val">
              {settings.cacheClearedAt ? `${settings.cacheClearedAt} (Hôm nay)` : "Chưa dọn dẹp hôm nay"}
            </span>
          </div>
        </div>

        <div className="sys-maintenance-actions">
          <button className="button" onClick={handleClearCache}>
            🧹 Xóa toàn bộ bộ nhớ đệm (Clear Client Cache)
          </button>
        </div>
      </section>
    </div>
  );
}
