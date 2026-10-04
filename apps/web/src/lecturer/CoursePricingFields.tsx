import { useUiText } from "../lib/i18n";
import { useId, useState } from "react";
import { RevenueQuote } from "./RevenueQuote";

/** Controlled course pricing for both create and edit forms. */
export function CoursePricingFields({
  initialPriceType = "FREE",
  initialPrice = "0",
  initialCurrency = "VND",
}: {
  initialPriceType?: string;
  initialPrice?: string;
  initialCurrency?: string;
}) {
  const uiText = useUiText();
  const [priceType, setPriceType] = useState(initialPriceType === "PAID" ? "PAID" : "FREE");
  const [price, setPrice] = useState(initialPriceType === "PAID" ? initialPrice : "0");
  const [currency, setCurrency] = useState(initialCurrency);
  const free = priceType === "FREE";
  const hintId = useId();
  return (
    <div className="form-grid" style={{ gridColumn: "1 / -1" }}>
      <label>
        {uiText("Hình thức học phí")}
        <select
          name="priceType"
          value={priceType}
          onChange={(event) => {
            setPriceType(event.target.value);
            if (event.target.value === "FREE") setPrice("0");
          }}
        >
          <option value="FREE">{uiText("Miễn phí")}</option>
          <option value="PAID">{uiText("Có học phí")}</option>
        </select>
      </label>
      <label>
        {uiText("Giá niêm yết")}
        <input
          aria-label={uiText("Giá niêm yết")}
          aria-describedby={free ? hintId : undefined}
          name="price"
          type="number"
          min="0"
          step={currency === "VND" ? "1" : "0.01"}
          value={free ? "0" : price}
          readOnly={free}
          required={!free}
          onChange={(event) => setPrice(event.target.value)}
        />
        {free && <small id={hintId}>{uiText("Khóa học miễn phí có giá niêm yết bằng 0.")}</small>}
      </label>
      <label>
        {uiText("Đơn vị tiền tệ")}
        <input
          name="currency"
          value={currency}
          required
          maxLength={3}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
        />
      </label>
      <RevenueQuote price={price} currency={currency} paid={!free} />
    </div>
  );
}
