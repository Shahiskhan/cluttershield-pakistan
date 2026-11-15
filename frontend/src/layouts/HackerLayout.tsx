import type { ReactNode } from "react";
import { DashboardLayout } from "./DashboardLayout";

export function HackerLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout title="Ethical hacker guild" description="Scoped, passive public-source research" nav={[
    { label: "Case workspace", to: "/hacker" },
  ]}>{children}</DashboardLayout>;
}
