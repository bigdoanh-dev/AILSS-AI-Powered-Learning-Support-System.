function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function passwordResetEmail(code: string, expiresMinutes: number) {
  const minutes = String(expiresMinutes);
  const safeCode = escapeHtml(code);
  const safeMinutes = escapeHtml(minutes);
  return {
    text: `Mã xác nhận đặt lại mật khẩu AILSS của bạn là ${code}. Mã có hiệu lực trong ${minutes} phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
    html: `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background-color:#ffffff;color:#142436;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#f4f7fb;border-radius:12px;">
        <tr><td style="padding:28px 24px 0;font-size:13px;font-weight:bold;letter-spacing:1px;color:#007cb5;">AILSS · XÁC THỰC TÀI KHOẢN</td></tr>
        <tr><td style="padding:20px 24px 0;font-size:24px;line-height:32px;font-weight:bold;">Đặt lại mật khẩu</td></tr>
        <tr><td style="padding:16px 24px 24px;font-size:14px;line-height:22px;">Nhập mã bên dưới để xác nhận yêu cầu của bạn. Mã chỉ sử dụng một lần và hết hạn sau ${safeMinutes} phút.</td></tr>
        <tr><td style="padding:0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf6fc;border-radius:10px;">
            <tr><td align="center" style="padding:24px 12px;font-size:32px;line-height:40px;letter-spacing:8px;font-weight:bold;color:#142436;">${safeCode}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px;font-size:13px;line-height:21px;color:#5d6d80;">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Không chia sẻ mã xác nhận với người khác.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
