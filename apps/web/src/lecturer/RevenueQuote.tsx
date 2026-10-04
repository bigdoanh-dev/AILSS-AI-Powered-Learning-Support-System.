import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { lecturerRequest } from "./api";

function format(amountMinor: bigint, currency: string, scale: bigint, locale: string) {
  const whole = new Intl.NumberFormat(locale).format(amountMinor / scale);
  const remainder = amountMinor % scale;
  return `${whole}${scale === 100n ? `${locale === "en-US" ? "." : ","}${String(remainder).padStart(2, "0")}` : ""} ${currency}`;
}

/** A quote for a newly listed price; settled revenue remains subject to refunds. */
export function RevenueQuote({
  initialPrice = "0",
  initialCurrency = "VND",
  initialPaid = true,
  commissionBasisPoints,
  price: controlledPrice,
  currency: controlledCurrency,
  paid: controlledPaid,
}: {
  initialPrice?: string;
  initialCurrency?: string;
  initialPaid?: boolean;
  commissionBasisPoints?: number;
  price?: string;
  currency?: string;
  paid?: boolean;
}) {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const [price, setPrice] = useState(initialPrice);
  const [currency, setCurrency] = useState(initialCurrency);
  const [paid, setPaid] = useState(initialPaid);
  const ref = useRef<HTMLDivElement>(null);
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [rateError, setRateError] = useState(false);
  useEffect(() => {
    if (commissionBasisPoints !== undefined) return;
    let active = true;
    void lecturerRequest<{ basisPoints: number }>("/me/commission")
      .then(({ data }) => {
        if (active) setLiveRate(data.basisPoints);
      })
      .catch(() => {
        if (active) setRateError(true);
      });
    return () => {
      active = false;
    };
  }, [commissionBasisPoints]);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => {
      const data = new FormData(form);
      setPrice(String(data.get("price") ?? "0"));
      setCurrency(String(data.get("currency") ?? "VND").toUpperCase());
      setPaid(data.get("priceType") !== "FREE");
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, []);
  const currentPrice = (controlledPrice ?? price).trim();
  const currentCurrency = (controlledCurrency ?? currency).trim().toUpperCase();
  const currentPaid = controlledPaid ?? paid;
  const scale = currentCurrency === "VND" ? 1n : 100n;
  const parts = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(currentPrice);
  const valid =
    !currentPaid || (!!parts && /^[A-Z]{3}$/.test(currentCurrency) && (scale !== 1n || !parts[2]));
  const amount =
    valid && currentPaid && parts
      ? BigInt(parts[1]!) * scale + (scale === 100n ? BigInt((parts[2] ?? "").padEnd(2, "0") || "0") : 0n)
      : 0n;
  const rate = commissionBasisPoints ?? liveRate;
  const fee = rate === null ? 0n : (amount * BigInt(rate)) / 10_000n;
  const percent = (basisPoints: number) =>
    `${(basisPoints / 100).toLocaleString(uiLocale, { maximumFractionDigits: 2 })}%`;
  return (
    <div className="revenue-quote" ref={ref} aria-live="polite">
      <strong>{uiText("Ước tính doanh thu mỗi lượt bán")}</strong>
      {rate === null ? (
        <p>
          {rateError
            ? uiText("Không tải được tỷ lệ chiết khấu. Hãy thử tải lại trang.")
            : uiText("Đang tải tỷ lệ chiết khấu…")}
        </p>
      ) : valid ? (
        <dl>
          <div>
            <dt>{uiText("Giá học viên trả")}</dt>
            <dd>{format(amount, currentCurrency, scale, uiLocale)}</dd>
          </div>
          <div>
            <dt>
              {uiText("Phí nền tảng (")}
              {percent(rate)})
            </dt>
            <dd>−{format(fee, currentCurrency, scale, uiLocale)}</dd>
          </div>
          <div>
            <dt>
              {uiText("Giảng viên nhận (")}
              {percent(10_000 - rate)})
            </dt>
            <dd>
              <strong>{format(amount - fee, currentCurrency, scale, uiLocale)}</strong>
            </dd>
          </div>
        </dl>
      ) : (
        <p>{uiText("Nhập giá hợp lệ để xem ước tính.")}</p>
      )}
      <small>
        {uiText(
          "Số thực nhận sẽ thay đổi nếu đơn hàng được hoàn tiền. Giá của đợt mở bán là giá dùng khi thanh toán.",
        )}
      </small>
    </div>
  );
}
