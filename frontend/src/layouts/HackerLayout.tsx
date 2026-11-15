import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function HackerLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="ethicalResearchTeam" description="scopedResearch" nav={[
    { label: "caseWorkspace", to: "/hacker" },
  ]}>{children}</DashboardLayout>;
}
