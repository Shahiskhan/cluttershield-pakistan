import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function CitizenLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="citizenServices" description="citizenServicesDescription" nav={[
    { label: "submitReport", to: "/citizen/report" },
    { label: "trackAReport", to: "/citizen/track" },
  ]}>{children}</DashboardLayout>;
}
