import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import type { TranslationKey } from "../i18n/translations";

export function DashboardLayout({ title, description, nav, children }: {
  title: TranslationKey;
  description: TranslationKey;
  nav: Array<{ label: TranslationKey; to: string }>;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <main className="page-shell dashboard-shell">
      <aside className="dashboard-sidebar" aria-label={`${t(title)} navigation`}>
        <p className="eyebrow">{t("workspace")}</p>
        {nav.map((item) => <Link key={item.to} to={item.to}>{t(item.label)}</Link>)}
      </aside>
      <section className="dashboard-main">
        <div className="page-heading"><p className="eyebrow">{t(title)}</p><h1>{t(description)}</h1></div>
        {children}
      </section>
    </main>
  );
}
