import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import type { TranslationKey } from "../../i18n/translations";
import {
  getMyAnalystApplication,
  submitAnalystApplication,
  type MyAnalystApplication,
} from "../../services/analystOnboardingService";

export function AnalystApplicationPage() {
  const { refreshRoles, roles } = useAuth();
  const { t, language } = useLanguage();
  const [application, setApplication] = useState<MyAnalystApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [motivation, setMotivation] = useState("");

  useEffect(() => {
    let active = true;
    void refreshRoles();
    getMyAnalystApplication()
      .then((result) => { if (active) setApplication(result); })
      .catch(() => { if (active) setError(t("applicationLoadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshRoles, t]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      setApplication(await submitAnalystApplication({
        fullName,
        affiliation: affiliation || null,
        portfolioUrl: portfolioUrl || null,
        motivation,
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message.includes("already_analyst")
        ? t("applicationAlreadyAnalyst")
        : message.includes("invalid_application")
          ? t("applicationInvalid")
          : t("applicationSubmitError"));
    } finally {
      setSubmitting(false);
    }
  };

  const refreshAccess = async () => {
    setError("");
    try {
      const [nextApplication] = await Promise.all([getMyAnalystApplication(), refreshRoles()]);
      setApplication(nextApplication);
    } catch {
      setError(t("applicationRefreshError"));
    }
  };

  return (
    <section className="page-shell narrow-shell stack-md">
      <div className="page-heading">
        <p className="eyebrow">{t("researcherPortal")}</p>
        <h1>{t("requestResearcherVerification")}</h1>
        <p className="muted mt-3">{t("researcherApplyIntro")}</p>
      </div>
      {loading ? <p className="muted">{t("authLoading")}</p> : application ? (
        <article className="result-card items-start text-left">
          <p className="eyebrow">{t("applicationStatus")}</p>
          <h2>{t(applicationStatusKey[application.status])}</h2>
          <p className="muted">{t("submittedAt")} {new Date(application.submitted_at).toLocaleString(language === "ur" ? "ur-PK" : "en-PK")}.</p>
          {application.status === "approved" && <p className="notice notice-success">{roles.includes("analyst") ? <>{t("roleActive")} <Link className="font-semibold underline" to="/researcher">{t("openCasePool")}</Link>.</> : t("approvalNeedsRefresh")}</p>}
          {application.status === "pending" && <p className="notice">{t("pendingApplication")}</p>}
          {application.status === "rejected" && <>
            <p className="notice notice-caution">{t("rejectedApplication")}</p>
            {application.reviewer_note && <p className="fine-print">{t("reviewerNote")} {application.reviewer_note}</p>}
            <button className="button button-secondary w-fit" type="button" onClick={() => setApplication(null)}>{t("updateReapply")}</button>
          </>}
          <button className="button button-secondary w-fit" type="button" onClick={() => void refreshAccess()}>{t("refreshAccess")}</button>
        </article>
      ) : (
        <form className="form-card form-stack" onSubmit={(event) => void submit(event)}>
          <label htmlFor="researcher-name">{t("researcherName")}
            <input id="researcher-name" required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>
          <label htmlFor="researcher-affiliation">{t("universityAffiliation")} <span className="muted font-normal">({t("optional")})</span>
            <input id="researcher-affiliation" maxLength={120} value={affiliation} onChange={(event) => setAffiliation(event.target.value)} />
          </label>
          <label htmlFor="researcher-portfolio">{t("publicPortfolio")} <span className="muted font-normal">({t("optional")})</span>
            <input id="researcher-portfolio" dir="ltr" type="url" maxLength={2048} placeholder="https://example.org/profile" value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} />
          </label>
          <label htmlFor="researcher-motivation">{t("researcherExperience")}
            <textarea id="researcher-motivation" required minLength={40} maxLength={2000} rows={6} value={motivation} onChange={(event) => setMotivation(event.target.value)} placeholder={t("researcherMotivationPlaceholder")} />
          </label>
          <div className="notice notice-caution">{t("publicResearchWarning")}</div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary w-fit" type="submit" disabled={submitting}>{submitting ? t("sendingRequest") : t("sendVerificationRequest")}</button>
        </form>
      )}
    </section>
  );
}

const applicationStatusKey: Record<MyAnalystApplication["status"], TranslationKey> = {
  pending: "applicationPending",
  approved: "applicationApproved",
  rejected: "applicationRejected",
};
