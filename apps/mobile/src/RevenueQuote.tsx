import { useLanguage } from "./use-language";
import { useUiText } from "./use-language";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { runtime } from "./runtime";
import { percent, quote, readCommission, type Commission } from "./finance";
import { Button, styles } from "./ui";

export function RevenueQuote({
  price,
  currency,
  paid = true,
}: {
  price: string;
  currency: string;
  paid?: boolean;
}) {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const [policy, setPolicy] = useState<Commission | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    setPolicy(null);
    void readCommission(runtime!, "LECTURER")
      .then((value) => {
        if (active) setPolicy(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const result = policy
    ? quote(paid ? price.trim() : "0", currency.trim().toUpperCase(), policy.basisPoints, uiLocale)
    : null;
  return (
    <View style={[styles.card, { gap: 6 }]} accessibilityLiveRegion="polite">
      <Text style={[styles.text, { fontWeight: "700" }]}>{uiText("Ước tính doanh thu mỗi lượt bán")}</Text>
      {error ? (
        <>
          <Text style={styles.error}>{uiText("Không tải được tỷ lệ chiết khấu.")}</Text>
          <Button label={uiText("Thử lại")} onPress={() => setRetry((value) => value + 1)} />
        </>
      ) : !policy ? (
        <Text style={styles.small}>{uiText("Đang tải tỷ lệ chiết khấu…")}</Text>
      ) : !result ? (
        <Text style={styles.error}>{uiText("Nhập giá hợp lệ để xem ước tính.")}</Text>
      ) : (
        <>
          <Text style={styles.text}>
            {uiText("Giá học viên trả: ")}
            {result.gross}
          </Text>
          <Text style={styles.text}>
            {uiText("Phí nền tảng (")}
            {percent(policy.basisPoints, uiLocale)}): −{result.fee}
          </Text>
          <Text style={[styles.text, { fontWeight: "700" }]}>
            {uiText("Giảng viên nhận (")}
            {percent(10_000 - policy.basisPoints, uiLocale)}): {result.earnings}
          </Text>
          <Text style={styles.small}>
            {uiText("Số thực nhận có thể thay đổi khi hoàn tiền. Đơn cũ giữ tỷ lệ tại lúc mua.")}
          </Text>
          <Button
            label={uiText("Làm mới tỷ lệ chiết khấu")}
            variant="outline"
            onPress={() => setRetry((value) => value + 1)}
          />
        </>
      )}
    </View>
  );
}
