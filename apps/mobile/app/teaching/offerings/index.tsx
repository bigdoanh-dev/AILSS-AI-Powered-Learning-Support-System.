import { useLanguage } from "../../../src/use-language";
import { useUiText } from "../../../src/use-language";
import { useState, useMemo } from "react";
import { StyleSheet, Text, TextInput, View, Pressable } from "react-native";
import { router, type Href } from "expo-router";
import { useMobileQuery } from "../../../src/queries";
import { ownedOfferings } from "../../../src/teaching";
import { Page, ScreenHeader, Button, Icon, tokens, styles } from "../../../src/ui";
import { ScalePressable, FadeSlideIn } from "../../../src/motion";

export default function Offerings() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const query = useMobileQuery("/api/v1/me/owned-offerings", ownedOfferings);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!query.data) return [];
    if (!search.trim()) return query.data;
    const s = search.toLowerCase().trim();
    return query.data.filter(
      (item) => item.title?.toLowerCase().includes(s) || item.state.toLowerCase().includes(s),
    );
  }, [query.data, search]);

  const activeCount = query.data?.filter((i) => i.state === "PUBLISHED").length ?? 0;

  return (
    <Page>
      <ScreenHeader
        title={uiText("Đợt mở bán")}
        subtitle={uiText("{0} đợt bán đã thiết lập", [query.data?.length ?? 0])}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching"))}
        rightElement={
          <Button
            label={uiText("+ Tạo mới")}
            size="sm"
            icon={<Icon name="add" size={14} color="#FFFFFF" />}
            onPress={() => router.push("/teaching/offerings/create" as Href)}
          />
        }
      />

      {query.data && query.data.length > 0 && (
        <FadeSlideIn duration={280}>
          {/* Quick Stats Strip */}
          <View style={os.statsStrip}>
            <View style={os.statItem}>
              <View style={[os.statIconBox, { backgroundColor: "#E6F7F7" }]}>
                <Icon name="tag" size={16} color={tokens.color.brand} />
              </View>
              <View>
                <Text style={os.statValue}>{query.data.length}</Text>
                <Text style={os.statLabel}>{uiText("Tổng đợt bán")}</Text>
              </View>
            </View>

            <View style={os.statDivider} />

            <View style={os.statItem}>
              <View style={[os.statIconBox, { backgroundColor: "#DCFCE7" }]}>
                <Icon name="checkCircle" size={16} color="#15803D" />
              </View>
              <View>
                <Text style={[os.statValue, { color: "#15803D" }]}>{activeCount}</Text>
                <Text style={os.statLabel}>{uiText("Đang mở bán")}</Text>
              </View>
            </View>

            <View style={os.statDivider} />

            <View style={os.statItem}>
              <View style={[os.statIconBox, { backgroundColor: "#FEF3C7" }]}>
                <Icon name="card" size={16} color="#D97706" />
              </View>
              <View>
                <Text style={os.statValue}>VND</Text>
                <Text style={os.statLabel}>{uiText("Tiền tệ")}</Text>
              </View>
            </View>
          </View>

          {/* Search bar */}
          <View style={os.searchBar}>
            <Icon name="search" size={16} color={tokens.color.muted} />
            <TextInput
              style={os.searchInput}
              placeholder={uiText("Tìm kiếm đợt mở bán...")}
              placeholderTextColor={tokens.color.muted}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <Pressable onPress={() => setSearch("")} style={{ padding: 4 }}>
                <Icon name="close" size={14} color={tokens.color.muted} />
              </Pressable>
            ) : null}
          </View>
        </FadeSlideIn>
      )}

      {query.loading ? (
        <View style={os.emptyBox}>
          <Text style={styles.text}>{uiText("Đang tải danh sách đợt mở bán…")}</Text>
        </View>
      ) : null}

      {query.error ? (
        <View style={os.errorCard}>
          <Text style={styles.error}>{uiText(query.error)}</Text>
          <Button label={uiText("Thử lại")} size="sm" onPress={query.retry} />
        </View>
      ) : null}

      {query.data?.length === 0 ? (
        <View style={os.emptyCard}>
          <View style={os.emptyIconBox}>
            <Icon name="tag" size={32} color={tokens.color.brand} />
          </View>
          <Text style={os.emptyTitle}>{uiText("Chưa có đợt mở bán nào")}</Text>
          <Text style={os.emptyDesc}>
            {uiText("Hãy tạo đợt mở bán để học viên có thể đăng ký và mua khóa học của bạn.")}
          </Text>
          <Button
            label={uiText("Tạo đợt mở bán ngay")}
            icon={<Icon name="add" size={16} color="#FFFFFF" />}
            onPress={() => router.push("/teaching/offerings/create" as Href)}
          />
        </View>
      ) : null}

      {filtered.map((item) => {
        const isPublished = item.state === "PUBLISHED";
        return (
          <ScalePressable
            key={item.offeringId}
            style={os.card}
            onPress={() => router.push(`/teaching/offerings/${item.offeringId}` as Href)}
          >
            <View style={os.cardAccent} />
            <View style={os.cardHeader}>
              <View style={[os.badge, isPublished ? os.badgePublished : os.badgeDraft]}>
                <View
                  style={[os.statusDot, { backgroundColor: isPublished ? tokens.color.success : "#D97706" }]}
                />
                <Text style={[os.badgeText, isPublished ? os.badgeTextPublished : os.badgeTextDraft]}>
                  {isPublished ? uiText("ĐÃ MỞ BÁN") : uiText("BẢN NHÁP")}
                </Text>
              </View>
              <View style={os.pricePill}>
                <Icon name="card" size={13} color="#0D9488" />
                <Text style={os.pricePillText}>
                  {item.price
                    ? `${Number(item.price).toLocaleString(uiLocale)} ${item.currency ?? "VND"}`
                    : uiText("Miễn phí")}
                </Text>
              </View>
            </View>

            <Text style={os.itemTitle}>{item.title}</Text>

            <View style={os.cardFooter}>
              <View style={os.typeBadge}>
                <Icon name="book" size={13} color={tokens.color.muted} />
                <Text style={os.typeBadgeText}>
                  {item.offeringType === "LIVE_COHORT"
                    ? uiText("Lớp học trực tiếp")
                    : uiText("Tự học có hướng dẫn")}
                </Text>
              </View>
              <View style={os.actionLink}>
                <Text style={os.actionLinkText}>{uiText("Chi tiết")}</Text>
                <Icon name="chevronRight" size={14} color={tokens.color.brand} />
              </View>
            </View>
          </ScalePressable>
        );
      })}
    </Page>
  );
}

const os = StyleSheet.create({
  statsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 12,
    ...tokens.shadow.subtle,
  },
  statItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  statLabel: {
    fontSize: 10,
    color: tokens.color.muted,
    fontWeight: "500",
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: tokens.color.border,
    marginHorizontal: 8,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    minHeight: 46,
    gap: 10,
    marginBottom: 14,
    ...tokens.shadow.subtle,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: tokens.color.ink,
    paddingVertical: 8,
  },
  card: {
    position: "relative",
    backgroundColor: tokens.color.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 12,
    overflow: "hidden",
    gap: 10,
    ...tokens.shadow.subtle,
  },
  cardAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 4,
    backgroundColor: tokens.color.brand,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgePublished: {
    backgroundColor: "#DCFCE7",
  },
  badgeDraft: {
    backgroundColor: "#FEF3C7",
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  badgeTextPublished: {
    color: "#166534",
  },
  badgeTextDraft: {
    color: "#92400E",
  },
  pricePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F0FDFA",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  pricePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F766E",
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    lineHeight: 22,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  typeBadgeText: {
    fontSize: 12,
    color: tokens.color.muted,
    fontWeight: "500",
  },
  actionLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  actionLinkText: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  emptyBox: {
    padding: 24,
    alignItems: "center",
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 12,
    ...tokens.shadow.subtle,
  },
  emptyIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: tokens.color.ink,
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 13,
    color: tokens.color.muted,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 280,
    marginBottom: 4,
  },
  errorCard: {
    backgroundColor: tokens.color.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.danger,
    gap: 8,
    marginBottom: 12,
  },
});
