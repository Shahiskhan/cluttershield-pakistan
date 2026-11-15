import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
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

const CATEGORY_OPTIONS: { value: ReportCategory; label: string }[] = [
  { value: "phishing_url", label: "Phishing URL" },
  { value: "impersonation", label: "Benazir / government impersonation" },
  { value: "payment_fraud", label: "JazzCash / EasyPaisa fraud" },
  { value: "delivery_fraud", label: "Courier scam" },
  { value: "investment_job_scam", label: "Investment / job scam" },
  { value: "other", label: "Other" },
];

const CHANNEL_OPTIONS: { value: ReportChannel; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone_call", label: "Phone call" },
  { value: "website_social_media", label: "Website / social media" },
];

const EVIDENCE_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
const MAX_EVIDENCE_LABEL = "5 MB";

export function ReportScamPage() {
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
      setEvidenceError(evidenceMessage(cause));
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
      setEvidenceError(evidenceMessage(cause));
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
      setError(submissionMessage(cause));
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
        <div className="page-heading"><p className="eyebrow">Citizen portal</p><h1>Report received</h1></div>
        <article className="result-card">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-700">✓</span>
          <h2>Your private tracking reference</h2>
          <p className="reference-code" aria-label={"Reference " + receipt.report_ref}>{receipt.report_ref}</p>
          <p className="muted">Save this reference somewhere private. It allows a status-only lookup and, for anonymous reports, authorizes private evidence uploads for this case. Do not share it publicly.</p>
          <p className="notice">A submission is an allegation for review. It is not a finding that a person or business acted unlawfully.</p>
          {evidenceFile && !evidenceUploaded && (
            <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="m-0 text-base font-bold text-amber-950">Report saved; evidence still needs to upload</h3>
              <p className="mt-1 text-sm text-amber-900">Your report is safe. Retry the private evidence upload for {evidenceFile.name}.</p>
              {evidenceError && <p className="form-error mt-3" role="alert">{evidenceError}</p>}
              <button className="button button-primary mt-3" onClick={() => void sendEvidence(receipt.report_ref, evidenceFile)} disabled={evidenceBusy}>
                {evidenceBusy ? <><Spinner /> Uploading evidence…</> : "Retry evidence upload"}
              </button>
            </div>
          )}
          {evidenceUploaded && <p className="notice notice-success w-full">Evidence uploaded to private quarantine. It is not publicly accessible and remains pending scanning and review.</p>}
          {evidenceError && !evidenceFile && !evidenceUploaded && <p className="form-error w-full" role="alert">The report was saved without an evidence attachment. {evidenceError}</p>}
          <div className="flex w-full flex-wrap gap-3">
            <Link className="button button-primary" to="/citizen/track">Track report status</Link>
            <button type="button" className="button button-secondary" onClick={startAnotherReport}>Submit another report</button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="page-shell narrow-shell stack-md">
      <div className="page-heading">
        <p className="eyebrow">Citizen portal</p>
        <h1>Report a suspected scam</h1>
        <p className="muted mt-3">Share the suspicious link or phone number and what happened. Reports are reviewed before any indicator can be published.</p>
      </div>
      <form className="form-card form-stack" onSubmit={onSubmit}>
        <div className="notice notice-caution">
          <strong>Protect your information.</strong> Do not include passwords, OTPs, or full bank PINs. Never upload identity documents or unrelated private records.
        </div>

        <div className="field-grid">
          <label htmlFor="report-category">Scam category
            <select id="report-category" name="category" value={category} onChange={(event) => setCategory(event.target.value as ReportCategory)} required>
              {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label htmlFor="report-channel">How did it reach you?
            <select id="report-channel" name="channel" value={channel} onChange={(event) => setChannel(event.target.value as ReportChannel)} required>
              {CHANNEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="field-grid">
          <label htmlFor="indicator-type">Suspicious item
            <select id="indicator-type" name="indicator_type" value={indicatorType} onChange={(event) => setIndicatorType(event.target.value as CitizenIndicatorType)} required>
              <option value="url">Website link (URL)</option>
              <option value="phone">Phone number</option>
            </select>
          </label>
          <label htmlFor="indicator-value">{indicatorType === "url" ? "Suspicious link" : "Phone number"}
            <input
              id="indicator-value"
              name="indicator_value"
              type={indicatorType === "url" ? "url" : "tel"}
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
              {indicatorType === "url" ? "Include the full public link if available." : "A Pakistani local number or international format is accepted, for example +92 300 1234567."}
            </span>
          </label>
        </div>

        <label htmlFor="incident-at">When did it happen? <span className="muted font-normal">(optional)</span>
          <input id="incident-at" name="incident_at" type="datetime-local" value={incidentAt} onChange={(event) => setIncidentAt(event.target.value)} />
        </label>

        <label htmlFor="narrative">What happened?
          <textarea
            id="narrative"
            name="narrative"
            required
            minLength={10}
            maxLength={5000}
            rows={6}
            value={narrative}
            onChange={(event) => setNarrative(event.target.value)}
            placeholder="Describe the message, call, offer, or payment request. Leave out secret codes and passwords."
            aria-describedby="narrative-help"
          />
          <span id="narrative-help" className="fine-print">{narrative.length}/5000 characters. Do not include passwords, OTPs, or full bank PINs.</span>
        </label>

        <label htmlFor="evidence-file">Evidence file <span className="muted font-normal">(optional)</span>
          <input ref={evidenceInputRef} id="evidence-file" name="evidence_file" type="file" accept={EVIDENCE_ACCEPT} onChange={onEvidenceChange} aria-describedby="evidence-help" className="file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:font-semibold file:text-teal-800" />
          <span id="evidence-help" className="fine-print">Screenshot or receipt only: JPG, PNG, WebP, or PDF, up to {MAX_EVIDENCE_LABEL}. Evidence is stored in private quarantine until a security scanning and review workflow is available.</span>
          {evidenceFile && <span className="flex flex-wrap items-center gap-3 text-sm font-medium text-slate-700">Selected: {evidenceFile.name} ({formatFileSize(evidenceFile.size)} of {formatFileSize(MAX_EVIDENCE_FILE_SIZE)})<button type="button" className="text-teal-800 underline underline-offset-2" onClick={clearEvidence}>Remove file</button></span>}
          {evidenceError && <span className="text-sm font-semibold text-red-700" role="alert">{evidenceError}</span>}
        </label>

        <label className="checkbox-label">
          <input type="checkbox" name="consent" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
          <span>I am reporting this in good faith. I understand this report may be reviewed for case handling and threat intelligence, and that a report does not prove wrongdoing.</span>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary w-full sm:w-fit" type="submit" disabled={!consent || submitting || evidenceBusy}>
          {submitting ? <><Spinner /> Submitting securely…</> : "Submit report"}
        </button>
        <p className="fine-print">Reports are sent through a protected intake service. Candidate indicators are not published automatically; evidence stays in private quarantine and requires a short-lived upload ticket.</p>
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

function submissionMessage(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "rate_limited") return "You have reached the short-term report limit. Please wait a little and try again.";
  if (code === "anonymous_intake_unavailable" || code === "server_configuration" || code === "service_unavailable") return "The reporting service is temporarily unavailable. Please try again later.";
  if (code === "invalid_indicator") return "Enter a valid public website link or an international phone number.";
  if (code === "authentication_required") return "Your session expired. Sign in again, then submit your report.";
  if (code === "role_required") return "This account is not active for citizen reporting. Please contact support.";
  if (code === "invalid_request") return "Some information could not be accepted. Review the fields and try again.";
  return "We could not submit the report. Your information is still on this page; please try again.";
}

function evidenceMessage(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "unsupported_evidence_type") return "Choose a JPG, PNG, WebP, or PDF file.";
  if (code === "evidence_size_limit") return "Evidence must be 5 MB or smaller.";
  if (code === "upload_ticket_expired") return "The secure upload expired. Retry to create a new upload authorization.";
  if (code === "upload_not_authorized") return "We could not authorize evidence for this report. Check that you are signed in as its owner.";
  if (code === "evidence_limit_reached") return "This report already has the maximum of three evidence files.";
  if (code === "rate_limited") return "Evidence uploads are temporarily limited. Please wait a few minutes and try again.";
  if (code === "evidence_not_allowed") return "Evidence cannot be added because this report is closed.";
  if (code === "authentication_required") return "Your session expired. Sign in again before uploading evidence.";
  return "The report was saved, but the evidence upload did not finish. You can retry from this page.";
}
