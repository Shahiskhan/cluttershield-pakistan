import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function AdminLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="Platform administrator" description="National operations and trust & safety" nav={[
    { label: "Overview", to: "/admin#admin-overview" },
    { label: "Report triage", to: "/admin#assigned-reports-title" },
    { label: "Researcher verification", to: "/admin#researcher-applications-title" },
    { label: "Indicator publication", to: "/admin#publication-queue-title" },
    { label: "Team collaboration", to: "/admin#team-chat" },
  ]}>{children}</DashboardLayout>;
}
