import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function CitizenLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="Citizen services" description="Report safely and follow your case" nav={[
    { label: "Submit a report", to: "/citizen/report" },
    { label: "Track a report", to: "/citizen/track" },
  ]}>{children}</DashboardLayout>;
}
