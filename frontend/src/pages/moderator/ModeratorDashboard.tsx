import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { TeamChat } from "../../components/collaboration/TeamChat";
import { StatusPill } from "../../components/StatusPill";
import { useAuth } from "../../context/AuthContext";
import { AnalystApplicationsPanel } from "./AnalystApplicationsPanel";
import {
  createOsintCase,
  getEvidencePreview,
  getIndicatorPublicationQueue,
  getModerationQueue,
  reviewIndicatorPublication,
  updateReportStatus,
  verifyReportIndicator,
  type IndicatorPublicationItem,
} from "../../services/moderationService";
import type { ModerationItem, ReportStatus } from "../../types";

export function ModeratorDashboard() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("platform_admin");
  const canModerate = roles.includes("moderator") || isAdmin;
  const canPublish = roles.includes("senior_reviewer") || roles.includes("platform_admin");
  const [reports, setReports] = useState<ModerationItem[]>([]);
  const [publicationItems, setPublicationItems] = useState<IndicatorPublicationItem[]>([]);
  const [pendingApplications, setPendingApplications] = useState<number | null>(null);
  const [loadingReports, setLoadingReports] = useState(canModerate);
  const [loadingPublication, setLoadingPublication] = useState(canPublish);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clarificationNotes, setClarificationNotes] = useState<Record<string, string>>({});
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [verificationConfirmed, setVerificationConfirmed] = useState(false);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, { url: string; expiresAt: string }>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [reviewUrls, setReviewUrls] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [confidenceById, setConfidenceById] = useState<Record<string, number>>({});
  const [caseFormId, setCaseFormId] = useState<string | null>(null);
  const [caseTitle, setCaseTitle] = useState("");
  const [caseBrief, setCaseBrief] = useState("");
  const [caseObjective, setCaseObjective] = useState("");
  const [caseSources, setCaseSources] = useState("");
  const [, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadReports = async () => {
    if (!canModerate) return;
    setLoadingReports(true);
    try {
      setReports(await getModerationQueue());
    } catch {
      setError(isAdmin ? "The administrator report queue is unavailable. Check the latest database migration and Edge Function deployment." : "The assigned moderation queue is unavailable. Check your active assignment and function deployment.");
    } finally {
      setLoadingReports(false);
    }
  };

  const loadPublicationQueue = async () => {
    if (!canPublish) return;
    setLoadingPublication(true);
    try {
      setPublicationItems(await getIndicatorPublicationQueue());
    } catch {
      setError("The independent publication review queue is unavailable.");
    } finally {
      setLoadingPublication(false);
    }
  };

  useEffect(() => {
    setError("");
    if (canModerate) void loadReports();
    if (canPublish) void loadPublicationQueue();
  }, [canModerate, canPublish]);

  const moveReport = async (item: ModerationItem, status: ReportStatus, reason: string, note: string | null = null) => {
    setWorkingId(item.id);
    setError("");
    setNotice("");
    try {
      await updateReportStatus(item.id, status, reason, note);
      setNotice(item.report_ref + " was updated.");
      await loadReports();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "scope_required"
        ? "This report is outside your current assignment."
        : "The status change could not be saved. The report may have changed since the queue loaded.");
    } finally {
      setWorkingId(null);
    }
  };

  const verify = async (event: FormEvent<HTMLFormElement>, item: ModerationItem) => {
    event.preventDefault();
    if (!verificationConfirmed || workingId) return;
    setWorkingId(item.id);
    setError("");
    setNotice("");
    try {
      const result = await verifyReportIndicator(item.id, verificationUrl.trim(), verificationNote.trim());
      setNotice(result.publication_state === "already_published"
        ? item.report_ref + " was accepted; its related indicator is already published."
        : item.report_ref + " was verified and sent for an independent second review. It is not public until that review approves it.");
      setVerificationId(null);
      setVerificationUrl("");
      setVerificationNote("");
      setVerificationConfirmed(false);
      await loadReports();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "scope_required"
        ? "This report is outside your active assignment."
        : "Verification could not be recorded. Check the public source and the report status.");
    } finally {
      setWorkingId(null);
    }
  };

  const publishCase = async (event: FormEvent<HTMLFormElement>, item: ModerationItem) => {
    event.preventDefault();
    const sources = caseSources.split(/[\n,]+/).map((source) => source.trim().toLowerCase()).filter(Boolean);
    if (!sources.length) {
      setError("Add at least one allowed public source domain.");
      return;
    }
    setWorkingId(item.id);
    setError("");
    setNotice("");
    try {
      const result = await createOsintCase({ reportId: item.id, title: caseTitle, brief: caseBrief, objective: caseObjective, allowedSources: sources });
      setNotice(`Sanitized research case ${result.case_ref} is available to approved analysts.`);
      setCaseFormId(null);
      setCaseTitle("");
      setCaseBrief("");
      setCaseObjective("");
      setCaseSources("");
      await loadReports();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message.includes("invalid_case")
        ? "The case was not accepted. Check that source entries are public domain names and the brief does not include contact details or the report reference."
        : "The OSINT case could not be created. It may already exist or the report may no longer be eligible.");
    } finally {
      setWorkingId(null);
    }
  };

  const preview = async (item: ModerationItem, evidenceId: string) => {
    const key = item.id + ":" + evidenceId;
    setPreviewBusy(key);
    setPreviewErrors((current) => ({ ...current, [key]: "" }));
    try {
      const result = await getEvidencePreview(item.id, evidenceId);
      setPreviews((current) => ({ ...current, [key]: { url: result.signed_url, expiresAt: result.expires_at } }));
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setPreviewErrors((current) => ({
        ...current,
        [key]: code === "evidence_pending_scan"
          ? "Preview is unavailable until the file passes scanning and quarantine release."
          : "A secure evidence preview could not be created.",
      }));
    } finally {
      setPreviewBusy(null);
    }
  };

  const decidePublication = async (item: IndicatorPublicationItem, decision: "approved" | "rejected") => {
    const note = reviewNotes[item.indicator_id]?.trim() ?? "";
    const source = reviewUrls[item.indicator_id]?.trim() ?? "";
    if (note.length < 10 || !source) {
      setError("Enter an independent public source and a review note before recording this decision.");
      return;
    }
    if (decision === "rejected" && !window.confirm("Reject this indicator from publication?")) return;
    setWorkingId(item.indicator_id);
    setError("");
    setNotice("");
    try {
      const confidence = confidenceById[item.indicator_id] ?? 70;
      const result = await reviewIndicatorPublication({
        indicatorId: item.indicator_id,
        decision,
        confidence: decision === "approved" ? confidence : null,
        verificationSourceUrl: source,
        verificationNote: note,
      });
      setNotice(result.status === "published"
        ? "Indicator approved by an independent reviewer and marked ready for feed compilation."
        : "Indicator was rejected from publication.");
      await loadPublicationQueue();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "independent_review_required"
        ? "The first reviewer cannot approve their own verification."
        : "The publication decision could not be saved. It may already have been reviewed.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="stack-lg">
      {isAdmin && (
        <section id="admin-overview" className="stack-md scroll-mt-6" aria-labelledby="admin-overview-title">
          <div><p className="eyebrow">Administrator overview</p><h2 id="admin-overview-title" className="m-0">Platform queues</h2><p className="muted mt-2">Review citizen reports, verify researcher applications, and make independent publication decisions.</p></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <a href="#assigned-reports-title" className="review-card transition hover:border-teal-400"><p className="eyebrow">Reports in queue</p><p className="m-0 text-3xl font-bold text-slate-900">{loadingReports ? "—" : reports.length}</p><p className="fine-print">Triage and review actions</p><span className="text-sm font-semibold text-teal-800">Open report queue →</span></a>
            <a href="#researcher-applications-title" className="review-card transition hover:border-teal-400"><p className="eyebrow">Researcher requests</p><p className="m-0 text-3xl font-bold text-slate-900">{pendingApplications === null ? "—" : pendingApplications}</p><p className="fine-print">Pending verification</p><span className="text-sm font-semibold text-teal-800">Review applications →</span></a>
            <a href="#publication-queue-title" className="review-card transition hover:border-teal-400"><p className="eyebrow">Indicator publication</p><p className="m-0 text-3xl font-bold text-slate-900">{loadingPublication ? "—" : publicationItems.length}</p><p className="fine-print">Awaiting independent review</p><span className="text-sm font-semibold text-teal-800">Review indicators →</span></a>
          </div>
        </section>
      )}
      <div className="notice notice-caution">
        A triage score is a routing aid, not a finding of guilt. Moderators see only assigned reports; administrators can review the full queue. Indicator publication requires source-backed verification and a separate reviewer.
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice notice-success" role="status">{notice}</p>}

      {canModerate && (
        <section className="stack-md" aria-labelledby="assigned-reports-title">
          <div className="section-title-row">
            <div><p className="eyebrow">{isAdmin ? "Administrator queue" : "Assigned work"}</p><h2 id="assigned-reports-title" className="m-0">Verification triage</h2></div>
            <button className="button button-secondary" type="button" onClick={() => void loadReports()} disabled={loadingReports}>Refresh</button>
          </div>
          {loadingReports ? <p className="muted">Loading assigned reports…</p> :
            reports.length === 0 ? <div className="empty-state"><h3>{isAdmin ? "No reports need administrator action" : "No pending assigned reports"}</h3><p>{isAdmin ? "New citizen reports and verified cases appear here." : "Reports appear here only while your assignment is active."}</p></div> :
              reports.map((item) => (
                <article className="review-card" key={item.id}>
                  <div className="review-card-heading">
                    <div><p className="eyebrow">{item.report_ref} · {item.category.replaceAll("_", " ")}</p><h3>{item.channel.replaceAll("_", " ")}</h3></div>
                    <StatusPill status={item.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">Triage score {item.risk_score}/100</span>
                    <span className="fine-print">Rule-based queue priority only · {item.priority} operational priority</span>
                  </div>
                  <p className="review-indicator"><strong>Masked indicator:</strong> {item.indicator_masked ?? "not available"}</p>
                  <p className="narrative rounded-lg bg-slate-50 p-4 text-slate-800">{item.narrative}</p>
                  <p className="fine-print">Submitted {new Date(item.created_at).toLocaleString()}</p>

                  {item.evidence.length > 0 && (
                    <section className="rounded-xl border border-slate-200 p-4" aria-label="Evidence files">
                      <h4 className="m-0 mb-2 text-sm font-bold">Evidence</h4>
                      <ul className="m-0 grid gap-2 p-0">
                        {item.evidence.map((evidence) => {
                          const key = item.id + ":" + evidence.id;
                          const signed = previews[key];
                          return (
                            <li key={evidence.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span className="text-slate-700">Private attachment · {evidence.scan_state.replaceAll("_", " ")}</span>
                              {evidence.can_preview && (!signed || Date.parse(signed.expiresAt) <= Date.now()) && (
                                <button className="button button-secondary min-h-9 py-1.5" type="button" disabled={previewBusy === key} onClick={() => void preview(item, evidence.id)}>
                                  {previewBusy === key ? "Preparing…" : "Create secure preview"}
                                </button>
                              )}
                              {evidence.can_preview && signed && new Date(signed.expiresAt).getTime() > Date.now() && (
                                <a className="font-semibold text-teal-800 underline underline-offset-2" href={signed.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open signed preview</a>
                              )}
                              {!evidence.can_preview && <span className="text-xs text-slate-500">Available after clean scan and quarantine release</span>}
                              {previewErrors[key] && <span className="w-full text-xs text-rose-700">{previewErrors[key]}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {(item.status === "submitted" || item.status === "needs_information") && (
                      <button className="button button-secondary" type="button" disabled={workingId === item.id} onClick={() => void moveReport(item, "triage", item.status === "submitted" ? "triage_started" : "information_received")}>
                        {item.status === "submitted" ? "Start triage" : "Return to triage"}
                      </button>
                    )}
                    {item.status === "triage" && (
                      <>
                        <button className="button button-secondary" type="button" disabled={workingId === item.id} onClick={() => void moveReport(item, "under_review", "review_started")}>Begin review</button>
                        <button className="button button-secondary" type="button" disabled={workingId === item.id || (clarificationNotes[item.id]?.trim().length ?? 0) < 10} onClick={() => void moveReport(item, "needs_information", "clarification_requested", clarificationNotes[item.id]?.trim() ?? null)}>Request clarification</button>
                      </>
                    )}
                    {(item.status === "submitted" || item.status === "triage" || item.status === "needs_information" || item.status === "under_review") && (
                      <button className="button button-secondary" type="button" disabled={workingId === item.id} onClick={() => void moveReport(item, "rejected", "spam_or_false_report")}>Reject (spam / false)</button>
                    )}
                    {item.status === "under_review" && (
                      <button className="button button-primary" type="button" disabled={workingId === item.id} onClick={() => { setVerificationId(verificationId === item.id ? null : item.id); setVerificationUrl(""); setVerificationNote(""); setVerificationConfirmed(false); }}>
                        Verify &amp; Publish Indicator
                      </button>
                    )}
                  </div>

                  {item.status === "triage" && (
                    <label className="text-sm font-semibold">Clarification note for the reporter
                      <textarea maxLength={500} rows={2} value={clarificationNotes[item.id] ?? ""} onChange={(event) => setClarificationNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Ask for one specific, non-sensitive detail." />
                      <span className="fine-print">Do not ask for passwords, OTPs, PINs, CNIC images, or unnecessary identity details.</span>
                    </label>
                  )}

                  {verificationId === item.id && (
                    <form className="form-card mt-2 border border-teal-200 bg-teal-50/40" onSubmit={(event) => void verify(event, item)}>
                      <h4 className="m-0">Record independent public verification</h4>
                      <p className="fine-print">This records a source-backed first review. A different senior reviewer or administrator must approve publication; this action does not publish the indicator by itself.</p>
                      <label>Public source URL
                        <input type="url" required maxLength={2048} value={verificationUrl} onChange={(event) => setVerificationUrl(event.target.value)} placeholder="https://official.example.gov.pk/security-notice" />
                      </label>
                      <label>Verification note
                        <textarea required minLength={10} maxLength={1000} rows={3} value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} placeholder="Explain what public evidence corroborates the indicator. Do not include citizen identifiers." />
                      </label>
                      <label className="checkbox-label"><input type="checkbox" checked={verificationConfirmed} onChange={(event) => setVerificationConfirmed(event.target.checked)} required /><span>I checked a public source independent of the citizen allegation and did not include personal data.</span></label>
                      <div className="flex flex-wrap gap-2">
                        <button className="button button-primary" type="submit" disabled={workingId === item.id || !verificationConfirmed}>{workingId === item.id ? "Recording…" : "Verify & queue for publication"}</button>
                        <button className="button button-secondary" type="button" onClick={() => setVerificationId(null)}>Cancel</button>
                      </div>
                    </form>
                  )}

                  {isAdmin && item.status === "accepted" && !item.osint_case_exists && (
                    <div className="stack-sm rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                      <div><h4 className="m-0">Create a sanitized OSINT case</h4><p className="fine-print mt-1">Analysts receive only the fields below. Do not copy the citizen narrative, report reference, phone numbers, names, account identifiers, or private evidence.</p></div>
                      {caseFormId !== item.id ? <button className="button button-secondary w-fit" type="button" onClick={() => { setCaseFormId(item.id); setCaseTitle(""); setCaseBrief(""); setCaseObjective(""); setCaseSources(""); }}>Prepare research task</button> : (
                        <form className="form-stack" onSubmit={(event) => void publishCase(event, item)}>
                          <label>Safe case title<input required minLength={3} maxLength={160} value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} /></label>
                          <label>Sanitized brief<textarea required minLength={10} maxLength={5000} rows={3} value={caseBrief} onChange={(event) => setCaseBrief(event.target.value)} placeholder="Describe the public threat pattern without identifying the reporting person or private target." /></label>
                          <label>Research objective<textarea required minLength={10} maxLength={1000} rows={2} value={caseObjective} onChange={(event) => setCaseObjective(event.target.value)} placeholder="State the bounded public-source question to investigate." /></label>
                          <label>Allowed public source domains <span className="muted font-normal">(one domain per line)</span><textarea required rows={3} value={caseSources} onChange={(event) => setCaseSources(event.target.value)} placeholder="example.gov.pk\nexample.org" /></label>
                          <div className="notice notice-caution">Analysts may use public sources only. Intrusion, credential access, private record collection, doxxing, and suspect contact are blocked by the case rules.</div>
                          <div className="flex flex-wrap gap-2"><button className="button button-primary" type="submit" disabled={workingId === item.id}>{workingId === item.id ? "Creating…" : "Publish sanitized case to analyst pool"}</button><button className="button button-secondary" type="button" onClick={() => setCaseFormId(null)}>Cancel</button></div>
                        </form>
                      )}
                    </div>
                  )}
                </article>
              ))}
        </section>
      )}

      {isAdmin && <AnalystApplicationsPanel onPendingCount={setPendingApplications} />}

      {canPublish && (
        <section className="stack-md" aria-labelledby="publication-queue-title">
          <div className="section-title-row">
            <div><p className="eyebrow">Senior reviewer / police reviewer</p><h2 id="publication-queue-title" className="m-0">Independent publication review</h2></div>
            <button className="button button-secondary" type="button" onClick={() => void loadPublicationQueue()} disabled={loadingPublication}>Refresh</button>
          </div>
          <p className="muted">Approve only with an independent public source. Approval marks an indicator ready for feed compilation; signed feed releases remain a separate controlled operation.</p>
          {loadingPublication ? <p className="muted">Loading publication queue…</p> :
            publicationItems.length === 0 ? <div className="empty-state"><h3>No indicators await senior review</h3><p>Moderators’ source-backed verifications appear here for independent review.</p></div> :
              publicationItems.map((item) => (
                <article className="review-card" key={item.indicator_id}>
                  <div className="review-card-heading"><div><p className="eyebrow">{item.report_ref} · {item.category.replaceAll("_", " ")}</p><h3>Masked indicator: {item.indicator_masked}</h3></div><span className="status-pill status-caution">Pending independent review</span></div>
                  <p className="text-sm text-slate-700">First reviewer source: <a href={item.verification_source_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{item.verification_source_url}</a></p>
                  <p className="narrative rounded-lg bg-slate-50 p-4 text-slate-800">{item.verification_note}</p>
                  <label>Your independent source URL
                    <input type="url" required maxLength={2048} value={reviewUrls[item.indicator_id] ?? ""} onChange={(event) => setReviewUrls((current) => ({ ...current, [item.indicator_id]: event.target.value }))} placeholder="https://official.example.gov.pk/notice" />
                  </label>
                  <label>Independent review note
                    <textarea minLength={10} maxLength={1000} rows={3} value={reviewNotes[item.indicator_id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [item.indicator_id]: event.target.value }))} placeholder="State why the public source supports or contradicts publication." />
                  </label>
                  <label>Confidence after corroboration: {confidenceById[item.indicator_id] ?? 70}%
                    <input type="range" min={50} max={90} step={5} value={confidenceById[item.indicator_id] ?? 70} onChange={(event) => setConfidenceById((current) => ({ ...current, [item.indicator_id]: Number(event.target.value) }))} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button className="button button-primary" type="button" disabled={workingId === item.indicator_id} onClick={() => void decidePublication(item, "approved")}>{workingId === item.indicator_id ? "Saving…" : "Approve & publish"}</button>
                    <button className="button button-secondary" type="button" disabled={workingId === item.indicator_id} onClick={() => void decidePublication(item, "rejected")}>Reject publication</button>
                  </div>
                </article>
              ))}
        </section>
      )}

      <div id="team-chat" className="scroll-mt-6"><TeamChat /></div>
    </section>
  );
}
