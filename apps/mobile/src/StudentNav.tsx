import { router, type Href, usePathname } from "expo-router";
import { BottomNavBar } from "./ui";

/** Keep the established Mobile navigation on the Phase 41 learning screens. */
export function StudentNav() {
  const pathname = usePathname();
  return (
    <BottomNavBar
      currentRoute={pathname === "/student" ? "home" : pathname}
      role="STUDENT"
      onNavigate={(path) => router.push(path as Href)}
    />
  );
}
