import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function ModeratorLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="reviewOperations" description="reviewDescription" nav={[
    { label: "verificationTriage", to: "/moderator" },
  ]}>{children}</DashboardLayout>;
}
