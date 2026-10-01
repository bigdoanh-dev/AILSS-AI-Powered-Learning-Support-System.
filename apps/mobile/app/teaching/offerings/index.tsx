import { Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useMobileQuery } from "../../../src/queries";
import { ownedOfferings } from "../../../src/teaching";
import { Page, ScreenHeader, Button, styles } from "../../../src/ui";
export default function Offerings() {
  const query = useMobileQuery("/api/v1/me/owned-offerings", ownedOfferings);
  return (
    <Page>
      <ScreenHeader title="Đợt mở bán" onBack={() => router.back()} />
      <Button label="Tạo đợt mở bán" onPress={() => router.push("/teaching/offerings/create" as Href)} />
      {query.loading ? <Text>Đang tải…</Text> : null}
      {query.error ? (
        <View>
          <Text style={styles.error}>{query.error}</Text>
          <Button label="Thử lại" onPress={query.retry} />
        </View>
      ) : null}
      {query.data?.length === 0 ? <Text>Chưa có đợt mở bán.</Text> : null}
      {query.data?.map((item) => (
        <View key={item.offeringId} style={styles.card}>
          <Text style={styles.title}>{item.title}</Text>
          <Text>
            {item.state} · {item.price} {item.currency}
          </Text>
          <Button
            label="Chi tiết"
            onPress={() => router.push(`/teaching/offerings/${item.offeringId}` as Href)}
          />
        </View>
      ))}
    </Page>
  );
}
