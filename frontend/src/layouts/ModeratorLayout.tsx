import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function ModeratorLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="Review operations" description="Moderated triage and independent publication review" nav={[
    { label: "Verification triage", to: "/moderator" },
  ]}>{children}</DashboardLayout>;
}
