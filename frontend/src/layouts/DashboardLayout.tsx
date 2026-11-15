import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function DashboardLayout({ title, description, nav, children }: {
  title: string;
  description: string;
  nav: Array<{ label: string; to: string }>;
  children: ReactNode;
}) {
  return (
    <main className="page-shell dashboard-shell">
      <aside className="dashboard-sidebar" aria-label={`${title} navigation`}>
        <p className="eyebrow">Workspace</p>
        {nav.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
      </aside>
      <section className="dashboard-main">
        <div className="page-heading"><p className="eyebrow">{title}</p><h1>{description}</h1></div>
        {children}
      </section>
    </main>
  );
}
