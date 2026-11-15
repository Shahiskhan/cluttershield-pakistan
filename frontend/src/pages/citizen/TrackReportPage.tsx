import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getOwnReport } from "../../services/reportService";
import type { OwnReport } from "../../types";

const STATUS_LABELS: Record<OwnReport["display_status"], string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  verified_public: "Verified Public",
  closed: "Closed",
  review_complete: "Review Complete",
};

export function TrackReportPage() {
  const { user } = useAuth();
  const [reportRef, setReportRef] = useState("");
  const [result, setResult] = useState<OwnReport | null>(null);
  const [error, setError] = useState("");
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
      setError(/^CS-[A-F0-9]{10}$/i.test(reportRef.trim()) && !user
        ? "This is an older reference. Sign in to the account that submitted it to check its status."
        : "No report status matched that reference. Check every character and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-shell narrow-shell stack-md">
      <div className="page-heading">
        <p className="eyebrow">Citizen portal</p>
        <h1>Track a report</h1>
        <p className="muted mt-3">Look up a report using its private reference. The lookup returns status and dates only, never the report narrative or identity details.</p>
      </div>
      <form className="form-card inline-form" onSubmit={lookup}>
          <label htmlFor="private-reference">Private report reference
            <input
              id="private-reference"
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
            <span id="reference-help" className="fine-print">Enter the full reference shown after submission. New references have 32 hex characters; older account-linked references have 10. Keep it private.</span>
          </label>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? <><span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent align-[-3px]" />Checking…</> : "Check status"}
          </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {error.includes("older reference") && !user && <Link className="button button-secondary w-fit" to="/auth">Sign in to check this older report</Link>}
      {result && (
        <article className="result-card" aria-live="polite">
          <p className="eyebrow">Private report status</p>
          <h2 className="reference-code">{result.report_ref}</h2>
          <span className={"status-pill " + (result.display_status === "verified_public" ? "status-positive" : result.display_status === "under_review" ? "status-caution" : "status-quiet")}>
            {STATUS_LABELS[result.display_status]}
          </span>
          <dl className="grid w-full gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold text-slate-600">Received</dt><dd className="mt-1 text-slate-900">{formatDate(result.created_at)}</dd></div>
            <div><dt className="font-semibold text-slate-600">Last updated</dt><dd className="mt-1 text-slate-900">{formatDate(result.updated_at)}</dd></div>
          </dl>
          <p className="muted">
            {result.display_status === "verified_public"
              ? "A related threat indicator has passed review and is currently published. This does not establish criminal guilt."
              : result.display_status === "review_complete"
                ? "Review has finished. The report did not result in a currently published public indicator."
                : result.display_status === "closed"
                  ? "This report is closed. A closed report is not a legal finding."
                  : "The report is being handled privately. A report does not by itself establish wrongdoing or guarantee recovery of funds."}
          </p>
        </article>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}
