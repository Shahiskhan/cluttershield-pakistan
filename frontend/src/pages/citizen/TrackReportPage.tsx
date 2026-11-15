import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import type { TranslationKey } from "../../i18n/translations";
import { getOwnReport } from "../../services/reportService";
import type { OwnReport } from "../../types";

const STATUS_LABELS: Record<OwnReport["display_status"], TranslationKey> = {
  submitted: "statusSubmitted",
  under_review: "statusUnderReview",
  verified_public: "statusVerifiedPublic",
  closed: "statusClosed",
  review_complete: "statusReviewComplete",
};

export function TrackReportPage() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [reportRef, setReportRef] = useState("");
  const [result, setResult] = useState<OwnReport | null>(null);
  const [error, setError] = useState<"olderReference" | "noStatusMatch" | "">("");
  const [busy, setBusy] = useState(false);

  const lookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await getOwnReport(reportRef.trim().toUpperCase()));
    } catch {
      setError(/^CS-[A-F0-9]{10}$/i.test(reportRef.trim()) && !user ? "olderReference" : "noStatusMatch");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-shell narrow-shell stack-md">
      <div className="page-heading">
        <p className="eyebrow">{t("citizenPortal")}</p>
        <h1>{t("trackTitle")}</h1>
        <p className="muted mt-3">{t("trackIntro")}</p>
      </div>
      <form className="form-card inline-form" onSubmit={lookup}>
          <label htmlFor="private-reference">{t("privateReportReference")}
            <input
              id="private-reference"
              dir="ltr"
              required
              pattern="CS-([A-F0-9]{10}|[A-F0-9]{32})"
              minLength={13}
              maxLength={35}
              autoComplete="off"
              spellCheck={false}
              value={reportRef}
              onChange={(event) => setReportRef(event.target.value.toUpperCase())}
              placeholder="CS-7F3A9C2D1E4B6A8F0D3C5E7A9B2D4F6A"
              aria-describedby="reference-help"
            />
            <span id="reference-help" className="fine-print">{t("referenceHelp")}</span>
          </label>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? <><span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent align-[-3px]" />{t("checking")}</> : t("checkStatus")}
          </button>
      </form>
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      {error === "olderReference" && !user && <Link className="button button-secondary w-fit" to="/auth">{t("signInOlderReport")}</Link>}
      {result && (
        <article className="result-card" aria-live="polite">
          <p className="eyebrow">{t("privateReportStatus")}</p>
          <h2 className="reference-code" dir="ltr">{result.report_ref}</h2>
          <span className={"status-pill " + (result.display_status === "verified_public" ? "status-positive" : result.display_status === "under_review" ? "status-caution" : "status-quiet")}>
            {t(STATUS_LABELS[result.display_status])}
          </span>
          <dl className="grid w-full gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold text-slate-600">{t("received")}</dt><dd className="mt-1 text-slate-900" dir="ltr">{formatDate(result.created_at, language)}</dd></div>
            <div><dt className="font-semibold text-slate-600">{t("lastUpdated")}</dt><dd className="mt-1 text-slate-900" dir="ltr">{formatDate(result.updated_at, language)}</dd></div>
          </dl>
          <p className="muted">
            {result.display_status === "verified_public"
              ? t("statusPublicExplain")
              : result.display_status === "review_complete"
                ? t("statusCompleteExplain")
                : result.display_status === "closed"
                  ? t("statusClosedExplain")
                  : t("statusPrivateExplain")}
          </p>
        </article>
      )}
    </section>
  );
}

function formatDate(value: string, language: "en" | "ur"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (language === "ur" ? "دستیاب نہیں" : "Unavailable") : date.toLocaleString(language === "ur" ? "ur-PK" : "en-PK");
}
