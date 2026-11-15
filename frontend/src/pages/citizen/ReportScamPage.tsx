import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import type { TranslationKey } from "../../i18n/translations";
import {
  createSubmissionKey,
  MAX_EVIDENCE_FILE_SIZE,
  submitReport,
  uploadEvidence,
  validateEvidenceFile,
  type ReportCategory,
  type ReportChannel,
  type CitizenIndicatorType,
} from "../../services/reportService";
import type { ReportReceipt } from "../../types";

const CATEGORY_OPTIONS: { value: ReportCategory; label: TranslationKey }[] = [
  { value: "phishing_url", label: "phishingUrl" },
  { value: "impersonation", label: "govtImpersonation" },
  { value: "payment_fraud", label: "walletFraud" },
  { value: "delivery_fraud", label: "courierScam" },
  { value: "investment_job_scam", label: "investmentJobScam" },
  { value: "other", label: "other" },
];

const CHANNEL_OPTIONS: { value: ReportChannel; label: TranslationKey }[] = [
  { value: "sms", label: "sms" },
  { value: "whatsapp", label: "whatsapp" },
  { value: "phone_call", label: "phoneCall" },
  { value: "website_social_media", label: "websiteSocial" },
];

const EVIDENCE_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
export function ReportScamPage() {
  const { t, language } = useLanguage();
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<ReportCategory>("phishing_url");
  const [channel, setChannel] = useState<ReportChannel>("sms");
  const [indicatorType, setIndicatorType] = useState<CitizenIndicatorType>("url");
  const [indicatorValue, setIndicatorValue] = useState("");
  const [incidentAt, setIncidentAt] = useState("");
  const [narrative, setNarrative] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  const [evidenceUploaded, setEvidenceUploaded] = useState(false);
  const [error, setError] = useState("");
  const [evidenceError, setEvidenceError] = useState("");

  const onEvidenceChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    setEvidenceError("");
    if (!file) {
      setEvidenceFile(null);
      return;
    }
    try {
      validateEvidenceFile(file);
      setEvidenceFile(file);
    } catch (cause) {
      setEvidenceFile(null);
      setEvidenceError(evidenceMessage(cause, t));
      event.currentTarget.value = "";
    }
  };

  const clearEvidence = () => {
    setEvidenceFile(null);
    setEvidenceError("");
    if (evidenceInputRef.current) evidenceInputRef.current.value = "";
  };

  const sendEvidence = async (reportRef: string, file: File) => {
    setEvidenceBusy(true);
    setEvidenceError("");
    try {
      await uploadEvidence(reportRef, file);
      setEvidenceUploaded(true);
      setEvidenceFile(null);
    } catch (cause) {
      setEvidenceError(evidenceMessage(cause, t));
    } finally {
      setEvidenceBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || evidenceBusy) return;
    setSubmitting(true);
    setError("");
    setEvidenceError("");
    try {
      const response = await submitReport({
        category,
        channel,
        incidentAt: incidentAt ? new Date(incidentAt).toISOString() : null,
        incidentTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi",
        narrative: narrative.trim(),
        indicator: { type: indicatorType, value: indicatorValue.trim() },
        consent: { accepted: true, noticeVersion: "citizen-notice-1.0" },
        submissionKey,
      });
      setReceipt(response);
      if (evidenceFile) await sendEvidence(response.report_ref, evidenceFile);
      setSubmissionKey(createSubmissionKey());
    } catch (cause) {
      setError(submissionMessage(cause, t));
    } finally {
      setSubmitting(false);
    }
  };

  const startAnotherReport = () => {
    setReceipt(null);
    setEvidenceUploaded(false);
    setEvidenceError("");
    setEvidenceFile(null);
    setIndicatorValue("");
    setIncidentAt("");
    setNarrative("");
    setConsent(false);
    setError("");
    setSubmissionKey(createSubmissionKey());
  };

  if (receipt) {
    return (
      <section className="page-shell narrow-shell stack-md" aria-live="polite">
        <div className="page-heading"><p className="eyebrow">{t("citizenPortal")}</p><h1>{t("reportReceived")}</h1></div>
        <article className="result-card">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-700">✓</span>
          <h2>{t("privateReferenceTitle")}</h2>
          <p className="reference-code" dir="ltr" aria-label={t("privateReferenceTitle") + " " + receipt.report_ref}>{receipt.report_ref}</p>
          <p className="muted">{t("saveReference")}</p>
          <p className="notice">{t("allegationNotice")}</p>
          {evidenceFile && !evidenceUploaded && (
            <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="m-0 text-base font-bold text-amber-950">{t("evidenceStillUploading")}</h3>
              <p className="mt-1 text-sm text-amber-900">{t("reportSafeRetry")} {evidenceFile.name}.</p>
              {evidenceError && <p className="form-error mt-3" role="alert">{evidenceError}</p>}
              <button className="button button-primary mt-3" onClick={() => void sendEvidence(receipt.report_ref, evidenceFile)} disabled={evidenceBusy}>
                {evidenceBusy ? <><Spinner /> {t("uploadingEvidence")}</> : t("retryEvidence")}
              </button>
            </div>
          )}
          {evidenceUploaded && <p className="notice notice-success w-full">{t("evidencePrivateNotice")}</p>}
          {evidenceError && !evidenceFile && !evidenceUploaded && <p className="form-error w-full" role="alert">{t("reportSavedNoEvidence")} {evidenceError}</p>}
          <div className="flex w-full flex-wrap gap-3">
            <Link className="button button-primary" to="/citizen/track">{t("trackThisReport")}</Link>
            <button type="button" className="button button-secondary" onClick={startAnotherReport}>{t("anotherReport")}</button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="page-shell narrow-shell stack-md">
      <div className="page-heading">
        <p className="eyebrow">{t("citizenPortal")}</p>
        <h1>{t("reportScamTitle")}</h1>
        <p className="muted mt-3">{t("reportScamIntro")}</p>
      </div>
      <form className="form-card form-stack" onSubmit={onSubmit}>
        <div className="notice notice-caution">
          <strong>{t("protectYourInfo")}</strong> {t("doNotIncludeSecrets")}
        </div>

        <div className="field-grid">
          <label htmlFor="report-category">{t("scamCategory")}
            <select id="report-category" name="category" value={category} onChange={(event) => setCategory(event.target.value as ReportCategory)} required>
              {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
            </select>
          </label>
          <label htmlFor="report-channel">{t("channelQuestion")}
            <select id="report-channel" name="channel" value={channel} onChange={(event) => setChannel(event.target.value as ReportChannel)} required>
              {CHANNEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
            </select>
          </label>
        </div>

        <div className="field-grid">
          <label htmlFor="indicator-type">{t("suspiciousItem")}
            <select id="indicator-type" name="indicator_type" value={indicatorType} onChange={(event) => setIndicatorType(event.target.value as CitizenIndicatorType)} required>
              <option value="url">{t("websiteUrl")}</option>
              <option value="phone">{t("phoneNumber")}</option>
            </select>
          </label>
          <label htmlFor="indicator-value">{indicatorType === "url" ? t("suspiciousLink") : t("phoneNumber")}
            <input
              id="indicator-value"
              name="indicator_value"
              type={indicatorType === "url" ? "url" : "tel"}
              dir="ltr"
              required
              minLength={3}
              maxLength={2048}
              value={indicatorValue}
              onChange={(event) => setIndicatorValue(event.target.value)}
              placeholder={indicatorType === "url" ? "https://example.com/offer" : "+92 300 1234567"}
              autoComplete="off"
              inputMode={indicatorType === "url" ? "url" : "tel"}
              aria-describedby="indicator-help"
            />
            <span id="indicator-help" className="fine-print">
              {indicatorType === "url" ? t("includeFullLink") : t("phoneNumberHelp")}
            </span>
          </label>
        </div>

        <label htmlFor="incident-at">{t("incidentWhen")} <span className="muted font-normal">({t("optional")})</span>
          <input id="incident-at" name="incident_at" type="datetime-local" dir="ltr" value={incidentAt} onChange={(event) => setIncidentAt(event.target.value)} />
        </label>

        <label htmlFor="narrative">{t("whatHappened")}
          <textarea
            id="narrative"
            name="narrative"
            required
            minLength={10}
            maxLength={5000}
            rows={6}
            value={narrative}
            onChange={(event) => setNarrative(event.target.value)}
            placeholder={t("narrativePlaceholder")}
            aria-describedby="narrative-help"
          />
          <span id="narrative-help" className="fine-print">{narrative.length}/5000 {language === "ur" ? "حروف" : "characters"}. {t("narrativeHelp")}</span>
        </label>

        <label htmlFor="evidence-file">{t("evidenceFile")} <span className="muted font-normal">({t("optional")})</span>
          <input ref={evidenceInputRef} id="evidence-file" name="evidence_file" type="file" accept={EVIDENCE_ACCEPT} onChange={onEvidenceChange} aria-describedby="evidence-help" className="file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:font-semibold file:text-teal-800" />
          <span id="evidence-help" className="fine-print">{t("evidenceOptionalHelp")}</span>
          {evidenceFile && <span className="flex flex-wrap items-center gap-3 text-sm font-medium text-slate-700">{t("selectedFile")} {evidenceFile.name} ({formatFileSize(evidenceFile.size)} / {formatFileSize(MAX_EVIDENCE_FILE_SIZE)})<button type="button" className="text-teal-800 underline underline-offset-2" onClick={clearEvidence}>{t("removeFile")}</button></span>}
          {evidenceError && <span className="text-sm font-semibold text-red-700" role="alert">{evidenceError}</span>}
        </label>

        <label className="checkbox-label">
          <input type="checkbox" name="consent" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
          <span>{t("consentGoodFaith")}</span>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary w-full sm:w-fit" type="submit" disabled={!consent || submitting || evidenceBusy}>
          {submitting ? <><Spinner /> {t("submitSecurely")}</> : t("submitButton")}
        </button>
        <p className="fine-print">{t("protectedIntake")}</p>
      </form>
    </section>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent align-[-3px]" />;
}

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + " KB" : (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function submissionMessage(cause: unknown, t: (key: TranslationKey) => string): string {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "rate_limited") return t("errorRateLimit");
  if (code === "anonymous_intake_unavailable" || code === "server_configuration" || code === "service_unavailable") return t("errorServiceUnavailable");
  if (code === "invalid_indicator") return t("errorInvalidIndicator");
  if (code === "authentication_required") return t("errorSessionExpired");
  if (code === "role_required") return t("errorRoleRequired");
  if (code === "invalid_request") return t("errorInvalidRequest");
  return t("errorSubmit");
}

function evidenceMessage(cause: unknown, t: (key: TranslationKey) => string): string {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "unsupported_evidence_type") return t("errorEvidenceType");
  if (code === "evidence_size_limit") return t("errorEvidenceSize");
  if (code === "upload_ticket_expired") return t("errorUploadExpired");
  if (code === "upload_not_authorized") return t("errorEvidenceAuth");
  if (code === "evidence_limit_reached") return t("errorEvidenceMax");
  if (code === "rate_limited") return t("errorEvidenceLimit");
  if (code === "evidence_not_allowed") return t("errorEvidenceClosed");
  if (code === "authentication_required") return t("errorSessionExpired");
  return t("errorEvidenceUpload");
}
