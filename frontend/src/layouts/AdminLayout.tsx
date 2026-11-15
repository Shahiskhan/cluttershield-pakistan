import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function AdminLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="platformAdministrator" description="nationalOperations" nav={[
    { label: "overview", to: "/admin#admin-overview" },
    { label: "reportTriage", to: "/admin#assigned-reports-title" },
    { label: "researcherVerification", to: "/admin#researcher-applications-title" },
    { label: "indicatorPublication", to: "/admin#publication-queue-title" },
    { label: "teamCollaboration", to: "/admin#team-chat" },
  ]}>{children}</DashboardLayout>;
}
