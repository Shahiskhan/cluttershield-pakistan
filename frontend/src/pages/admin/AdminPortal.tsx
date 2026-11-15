import { Link } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { ModeratorDashboard } from "../moderator/ModeratorDashboard";

/** Admin-only console: keeps all existing review actions while giving admins a distinct entry experience. */
export function AdminPortal() {
  const { t } = useLanguage();
  return (
    <div className="space-y-8">
      <section id="admin-overview" className="scroll-mt-28 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-6 text-white shadow-xl sm:p-9">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-bold uppercase tracking-[.2em] text-teal-300">FraudAlert Pakistan · {t("platformAdministrator")}</p>
            <h2 className="m-0 text-3xl font-extrabold leading-tight sm:text-4xl">{t("nationalOperations")}</h2>
            <p className="mb-0 mt-3 max-w-xl text-sm leading-7 text-slate-300">{t("adminOverviewIntro")}</p>
          </div>
          <Link className="button border border-white/20 bg-white/10 text-white hover:bg-white/15" to="/citizen/report">{t("submitReport")}</Link>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <a className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white no-underline transition hover:bg-white/10" href="#assigned-reports-title"><span className="block text-xs font-bold text-teal-200">01 · {t("reportTriage")}</span><span className="mt-2 block text-lg font-bold">{t("openReportQueue")} →</span><span className="mt-1 block text-xs text-slate-300">{t("triageReviewActions")}</span></a>
          <a className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white no-underline transition hover:bg-white/10" href="#researcher-applications-title"><span className="block text-xs font-bold text-teal-200">02 · {t("researcherVerification")}</span><span className="mt-2 block text-lg font-bold">{t("reviewApplications")} →</span><span className="mt-1 block text-xs text-slate-300">{t("pendingVerification")}</span></a>
          <a className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white no-underline transition hover:bg-white/10" href="#publication-queue-title"><span className="block text-xs font-bold text-teal-200">03 · {t("indicatorPublication")}</span><span className="mt-2 block text-lg font-bold">{t("reviewWarnings")} →</span><span className="mt-1 block text-xs text-slate-300">{t("independentReview")}</span></a>
        </div>
      </section>
      <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-950">{t("cautionTriage")}</div>
      <ModeratorDashboard showAdminOverview={false} />
    </div>
  );
}
