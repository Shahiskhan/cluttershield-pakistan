import { useLanguage } from "../context/LanguageContext";
import { Link } from "react-router-dom";

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="site-footer mt-12 border-t border-slate-700 bg-slate-950 text-slate-200">
      <div className="page-shell grid gap-10 py-10 sm:grid-cols-[1.4fr_.8fr_1fr] sm:py-14">
        <div>
          <Link className="mb-4 inline-flex items-center gap-3 text-white no-underline" to="/">
            <span className="grid size-10 place-items-center rounded-xl bg-teal-600 text-lg font-black text-white">F</span>
            <span className="text-base font-extrabold">{t("brand")}</span>
          </Link>
          <p className="max-w-md text-sm leading-7 text-slate-300">{t("footerPurpose")}</p>
          <p className="m-0 inline-flex rounded-full border border-teal-800 bg-teal-950/60 px-3 py-1.5 text-xs font-semibold text-teal-200">{t("publicSafety")}</p>
        </div>
        <nav className="grid content-start gap-3 text-sm" aria-label={t("citizenServices")}>
          <h2 className="mb-1 text-xs font-extrabold uppercase tracking-[.16em] text-teal-300">{t("citizenServices")}</h2>
          <Link className="text-slate-200 no-underline hover:text-teal-300" to="/citizen/report">{t("report")}</Link>
          <Link className="text-slate-200 no-underline hover:text-teal-300" to="/citizen/track">{t("track")}</Link>
          <Link className="text-slate-200 no-underline hover:text-teal-300" to="/auth?mode=signup&next=%2Fresearcher">{t("joinResearcher")}</Link>
        </nav>
        <div className="rounded-2xl border border-amber-900/70 bg-amber-950/30 p-4">
          <h2 className="mb-2 text-sm font-bold text-amber-200">{t("protectYourInfo")}</h2>
          <p className="m-0 text-sm leading-7 text-amber-100/90">{t("footerSecrets")}</p>
        </div>
      </div>
      <div className="border-t border-slate-800"><div className="page-shell flex flex-col gap-2 py-4 text-xs leading-6 text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>© {new Date().getFullYear()} {t("brand")}</span><span>{t("footerPurpose")}</span></div></div>
    </footer>
  );
}
