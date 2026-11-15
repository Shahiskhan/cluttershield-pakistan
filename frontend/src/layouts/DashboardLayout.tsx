import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { useLocation } from "react-router-dom";

export function DashboardLayout({ title, description, nav, children }: {
  title: TranslationKey;
  description: TranslationKey;
  nav: Array<{ label: TranslationKey; to: string }>;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const location = useLocation();
  return (
    <main className="page-shell dashboard-shell">
      <aside className="dashboard-sidebar" aria-label={`${t(title)} navigation`}>
        <p className="eyebrow">{t("workspace")}</p>
        {nav.map((item) => {
          const hashIndex = item.to.indexOf("#");
          if (hashIndex >= 0) {
            const targetId = item.to.slice(hashIndex + 1);
            return <a key={item.to} href={item.to} onClick={(event) => {
              event.preventDefault();
              const target = document.getElementById(targetId);
              if (target) {
                window.history.replaceState(null, "", `${location.pathname}#${targetId}`);
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                if (target instanceof HTMLElement && target.matches("h1, h2, h3, h4")) target.focus({ preventScroll: true });
              }
            }}>{t(item.label)}</a>;
          }
          return <Link key={item.to} to={item.to}>{t(item.label)}</Link>;
        })}
      </aside>
      <section className="dashboard-main">
        <div className="page-heading"><p className="eyebrow">{t(title)}</p><h1>{t(description)}</h1></div>
        {children}
      </section>
    </main>
  );
}
