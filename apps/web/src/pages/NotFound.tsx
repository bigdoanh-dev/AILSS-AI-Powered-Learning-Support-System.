import { useUiText } from "../lib/i18n";
import { ButtonLink } from "../components/ui";
import { NotFound3DScene } from "../components/NotFound3DScene";

export default function NotFound() {
  const uiText = useUiText();
  return (
    <div className="notfound-page-wrapper notfound-minimal">
      <div className="container notfound-center-container">
        {/* 3D 404 Centerpiece */}
        <div className="notfound-3d-stage">
          <NotFound3DScene />
        </div>

        {/* Minimal text and action */}
        <div className="notfound-minimal-content">
          <h1>{uiText("Trang này chưa có ở đây.")}</h1>
          <p className="notfound-minimal-sub">{uiText("Đường dẫn có thể đã thay đổi hoặc không tồn tại.")}</p>
          <div className="notfound-minimal-actions">
            <ButtonLink to="/">{uiText("Về trang chủ")}</ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}
