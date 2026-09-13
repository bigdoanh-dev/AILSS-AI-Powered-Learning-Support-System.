import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../../../packages/http/src/index.js";

export function paymentMode(): "simulation" | "sepay" {
  const mode = process.env.PAYMENT_MODE;
  if (mode === "sepay") return mode;
  if (
    mode === "simulation" &&
    process.env.NODE_ENV !== "production" &&
    (process.env.NODE_ENV === "test" || ["dev-core", "dev-async"].includes(process.env.AILSS_PROFILE ?? ""))
  )
    return mode;
  throw new AppError("PAYMENT_MODE_INVALID", 503, "Payment mode is not configured for this runtime");
}
export function sepayConfig() {
  if (paymentMode() !== "sepay")
    throw new AppError("PAYMENT_PROVIDER_DISABLED", 403, "Payment provider is disabled");
  const apiKey = process.env.SEPAY_WEBHOOK_API_KEY;
  const accountNumber = process.env.SEPAY_ACCOUNT_NUMBER;
  const bank = process.env.SEPAY_BANK;
  const accountName = process.env.SEPAY_ACCOUNT_NAME;
  if (!apiKey || apiKey.length < 32 || !accountNumber || !bank || !accountName)
    throw new AppError("PAYMENT_NOT_CONFIGURED", 503, "Thanh toán chưa được cấu hình. Vui lòng thử lại sau.");
  return { apiKey, accountNumber, bank, accountName };
}
export function authenticateSepay(authorization: string | undefined) {
  const expected = Buffer.from(`Apikey ${sepayConfig().apiKey}`);
  const actual = Buffer.from(authorization ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError("INVALID_WEBHOOK_AUTH", 401, "Invalid webhook credentials");
}
export const sepaySchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  accountNumber: z.string().min(1),
  transferType: z.enum(["in", "out"]),
  transferAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  content: z.string().max(4000),
  code: z.string().nullable().optional(),
  referenceCode: z.string().nullable().optional(),
});
export type SepayTransaction = z.infer<typeof sepaySchema>;
export function paymentContent(orderId: string) {
  return `AILSS${orderId.replaceAll("-", "").toUpperCase()}`;
}
export function paymentOrderId(content: string) {
  const matches = [...content.toUpperCase().matchAll(/(?:^|[^A-Z0-9])AILSS([A-F0-9]{32})(?![A-Z0-9])/g)];
  if (matches.length !== 1) return undefined;
  const token = matches[0]?.[1];
  if (!token) return undefined;
  const hex = token.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function paymentInstructions(order: { orderId: string; price: string; currency: string }) {
  try {
    const c = sepayConfig();
    if (order.currency !== "VND" || !/^\d+(?:\.0+)?$/.test(order.price)) return undefined;
    const content = paymentContent(order.orderId);
    const params = new URLSearchParams({
      acc: c.accountNumber,
      bank: c.bank,
      amount: String(Number(order.price)),
      des: content,
    });
    return {
      provider: "SEPAY",
      accountNumber: c.accountNumber,
      accountName: c.accountName,
      bank: c.bank,
      content,
      qrUrl: `https://qr.sepay.vn/img?${params.toString()}`,
    };
  } catch {
    return undefined;
  }
}
