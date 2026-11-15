import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { TeamChat } from "../../components/collaboration/TeamChat";
import { StatusPill } from "../../components/StatusPill";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import type { TranslationKey } from "../../i18n/translations";
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

const CATEGORY_TRANSLATIONS: Record<string, TranslationKey> = {
  phishing_url: "phishingUrl", impersonation: "govtImpersonation", payment_fraud: "walletFraud",
  delivery_fraud: "courierScam", investment_job_scam: "investmentJobScam", account_takeover: "accountTakeover",
  marketplace_fraud: "marketplaceFraud", other: "other",
};
const CHANNEL_TRANSLATIONS: Record<string, TranslationKey> = {
  sms: "sms", whatsapp: "whatsapp", phone_call: "phoneCall", website: "statusWebsite",
  website_social_media: "websiteSocial", social_media: "statusSocialMedia", email: "statusEmail",
};
const SCAN_TRANSLATIONS: Record<string, TranslationKey> = {
  pending: "scanPending", clean: "scanClean", malicious: "scanMalicious", error: "scanError",
};

export function ModeratorDashboard() {
  const { roles } = useAuth();
  const { t, language } = useLanguage();
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
      setError(isAdmin ? t("adminQueueUnavailable") : t("assignedQueueUnavailable"));
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
      setError(t("publicationQueueUnavailable"));
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
      setNotice(t("reportUpdated") + " " + item.report_ref);
      await loadReports();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "scope_required"
        ? t("reportOutsideAssignment")
        : t("statusSaveFailed"));
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
        ? t("alreadyPublished")
        : t("secondReviewQueued"));
      setVerificationId(null);
      setVerificationUrl("");
      setVerificationNote("");
      setVerificationConfirmed(false);
      await loadReports();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "scope_required"
        ? t("reportOutsideAssignment")
        : t("verifyFailed"));
    } finally {
      setWorkingId(null);
    }
  };

  const publishCase = async (event: FormEvent<HTMLFormElement>, item: ModerationItem) => {
    event.preventDefault();
    const sources = caseSources.split(/[\n,]+/).map((source) => source.trim().toLowerCase()).filter(Boolean);
    if (!sources.length) {
      setError(t("addAllowedSource"));
      return;
    }
    setWorkingId(item.id);
    setError("");
    setNotice("");
    try {
      const result = await createOsintCase({ reportId: item.id, title: caseTitle, brief: caseBrief, objective: caseObjective, allowedSources: sources });
      setNotice(`${t("caseAvailable")} ${result.case_ref}`);
      setCaseFormId(null);
      setCaseTitle("");
      setCaseBrief("");
      setCaseObjective("");
      setCaseSources("");
      await loadReports();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message.includes("invalid_case")
        ? t("invalidCase")
        : t("caseCreateFailed"));
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
        [key]: code === "evidence_pending_scan" ? t("previewAwaitScan") : t("previewFailed"),
      }));
    } finally {
      setPreviewBusy(null);
    }
  };

  const decidePublication = async (item: IndicatorPublicationItem, decision: "approved" | "rejected") => {
    const note = reviewNotes[item.indicator_id]?.trim() ?? "";
    const source = reviewUrls[item.indicator_id]?.trim() ?? "";
    if (note.length < 10 || !source) {
      setError(t("independentSourceRequired"));
      return;
    }
    if (decision === "rejected" && !window.confirm(t("confirmRejectWarning"))) return;
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
      setNotice(result.status === "published" ? t("warningPublished") : t("warningRejected"));
      await loadPublicationQueue();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "independent_review_required"
        ? t("cannotApproveOwn")
        : t("warningDecisionFailed"));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="stack-lg">
      {isAdmin && (
        <section id="admin-overview" className="stack-md scroll-mt-6" aria-labelledby="admin-overview-title">
          <div><p className="eyebrow">{t("administratorOverview")}</p><h2 id="admin-overview-title" className="m-0">{t("platformQueues")}</h2><p className="muted mt-2">{t("adminOverviewIntro")}</p></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <a href="#assigned-reports-title" className="review-card transition hover:border-teal-400"><p className="eyebrow">{t("reportsInQueue")}</p><p className="m-0 text-3xl font-bold text-slate-900">{loadingReports ? "—" : reports.length}</p><p className="fine-print">{t("triageReviewActions")}</p><span className="text-sm font-semibold text-teal-800">{t("openReportQueue")}</span></a>
            <a href="#researcher-applications-title" className="review-card transition hover:border-teal-400"><p className="eyebrow">{t("pendingResearcherRequests")}</p><p className="m-0 text-3xl font-bold text-slate-900">{pendingApplications === null ? "—" : pendingApplications}</p><p className="fine-print">{t("pendingVerification")}</p><span className="text-sm font-semibold text-teal-800">{t("reviewApplications")}</span></a>
            <a href="#publication-queue-title" className="review-card transition hover:border-teal-400"><p className="eyebrow">{t("pendingWarnings")}</p><p className="m-0 text-3xl font-bold text-slate-900">{loadingPublication ? "—" : publicationItems.length}</p><p className="fine-print">{t("independentReview")}</p><span className="text-sm font-semibold text-teal-800">{t("reviewWarnings")}</span></a>
          </div>
        </section>
      )}
      <div className="notice notice-caution">
        {t("cautionTriage")}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice notice-success" role="status">{notice}</p>}

      {canModerate && (
        <section className="stack-md" aria-labelledby="assigned-reports-title">
          <div className="section-title-row">
            <div><p className="eyebrow">{isAdmin ? t("administratorQueue") : t("assignedWork")}</p><h2 id="assigned-reports-title" className="m-0">{t("verificationQueue")}</h2></div>
            <button className="button button-secondary" type="button" onClick={() => void loadReports()} disabled={loadingReports}>{t("refresh")}</button>
          </div>
          {loadingReports ? <p className="muted">{t("loadingApplications")}</p> :
            reports.length === 0 ? <div className="empty-state"><h3>{isAdmin ? t("noAdminReports") : t("noAssignedReports")}</h3><p>{isAdmin ? t("newPublicReports") : t("assignedReportsAppear")}</p></div> :
              reports.map((item) => (
                <article className="review-card" key={item.id}>
                  <div className="review-card-heading">
                    <div><p className="eyebrow"><bdi dir="ltr">{item.report_ref}</bdi> · {t(CATEGORY_TRANSLATIONS[item.category] ?? "other")}</p><h3>{t(CHANNEL_TRANSLATIONS[item.channel] ?? "statusWebsite")}</h3></div>
                    <StatusPill status={item.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{t("triageScoreLabel")} {item.risk_score}/100</span>
                    <span className="fine-print">{t("rulePriority")} · {t(item.priority === "urgent" ? "statusUrgent" : item.priority === "high" ? "statusHigh" : "statusNormal")} {t("operationalPriority")}</span>
                  </div>
                  <p className="review-indicator"><strong>{t("maskedIndicator")}</strong> <bdi dir="ltr">{item.indicator_masked ?? t("unavailable")}</bdi></p>
                  <p className="narrative rounded-lg bg-slate-50 p-4 text-slate-800">{item.narrative}</p>
                  <p className="fine-print">{t("submittedAt")} {new Date(item.created_at).toLocaleString(language === "ur" ? "ur-PK" : "en-PK")}</p>

                  {item.evidence.length > 0 && (
                    <section className="rounded-xl border border-slate-200 p-4" aria-label={t("evidenceFiles")}>
                      <h4 className="m-0 mb-2 text-sm font-bold">{t("evidenceFiles")}</h4>
                      <ul className="m-0 grid gap-2 p-0">
                        {item.evidence.map((evidence) => {
                          const key = item.id + ":" + evidence.id;
                          const signed = previews[key];
                          return (
                            <li key={evidence.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span className="text-slate-700">{t("privateAttachment")} · {t(SCAN_TRANSLATIONS[evidence.scan_state] ?? "scanPending")}</span>
                              {evidence.can_preview && (!signed || Date.parse(signed.expiresAt) <= Date.now()) && (
                                <button className="button button-secondary min-h-9 py-1.5" type="button" disabled={previewBusy === key} onClick={() => void preview(item, evidence.id)}>
                                  {previewBusy === key ? t("preparingPreview") : t("secureEvidencePreview")}
                                </button>
                              )}
                              {evidence.can_preview && signed && new Date(signed.expiresAt).getTime() > Date.now() && (
                                <a className="font-semibold text-teal-800 underline underline-offset-2" href={signed.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("openSignedPreview")}</a>
                              )}
                              {!evidence.can_preview && <span className="text-xs text-slate-500">{t("previewAfterScan")}</span>}
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
                        {item.status === "submitted" ? t("startTriage") : t("returnTriage")}
                      </button>
                    )}
                    {item.status === "triage" && (
                      <>
                        <button className="button button-secondary" type="button" disabled={workingId === item.id} onClick={() => void moveReport(item, "under_review", "review_started")}>{t("beginReview")}</button>
                        <button className="button button-secondary" type="button" disabled={workingId === item.id || (clarificationNotes[item.id]?.trim().length ?? 0) < 10} onClick={() => void moveReport(item, "needs_information", "clarification_requested", clarificationNotes[item.id]?.trim() ?? null)}>{t("requestClarification")}</button>
                      </>
                    )}
                    {(item.status === "submitted" || item.status === "triage" || item.status === "needs_information" || item.status === "under_review") && (
                      <button className="button button-secondary" type="button" disabled={workingId === item.id} onClick={() => void moveReport(item, "rejected", "spam_or_false_report")}>{t("rejectSpam")}</button>
                    )}
                    {item.status === "under_review" && (
                      <button className="button button-primary" type="button" disabled={workingId === item.id} onClick={() => { setVerificationId(verificationId === item.id ? null : item.id); setVerificationUrl(""); setVerificationNote(""); setVerificationConfirmed(false); }}>
                        {t("verifyIndicator")}
                      </button>
                    )}
                  </div>

                  {item.status === "triage" && (
                    <label className="text-sm font-semibold">{t("clarificationNote")}
                      <textarea maxLength={500} rows={2} value={clarificationNotes[item.id] ?? ""} onChange={(event) => setClarificationNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={t("clarificationPlaceholder")} />
                      <span className="fine-print">{t("noSensitiveClarification")}</span>
                    </label>
                  )}

                  {verificationId === item.id && (
                    <form className="form-card mt-2 border border-teal-200 bg-teal-50/40" onSubmit={(event) => void verify(event, item)}>
                      <h4 className="m-0">{t("recordPublicVerification")}</h4>
                      <p className="fine-print">{t("secondReviewerRequired")}</p>
                      <label>{t("firstPublicSourceUrl")}
                        <input type="url" dir="ltr" required maxLength={2048} value={verificationUrl} onChange={(event) => setVerificationUrl(event.target.value)} placeholder="https://official.example.gov.pk/security-notice" />
                      </label>
                      <label>{t("verificationNote")}
                        <textarea required minLength={10} maxLength={1000} rows={3} value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} placeholder={t("verificationNotePlaceholder")} />
                      </label>
                      <label className="checkbox-label"><input type="checkbox" checked={verificationConfirmed} onChange={(event) => setVerificationConfirmed(event.target.checked)} required /><span>{t("checkedIndependentSource")}</span></label>
                      <div className="flex flex-wrap gap-2">
                        <button className="button button-primary" type="submit" disabled={workingId === item.id || !verificationConfirmed}>{workingId === item.id ? t("recording") : t("verifyQueuePublication")}</button>
                        <button className="button button-secondary" type="button" onClick={() => setVerificationId(null)}>{t("cancel")}</button>
                      </div>
                    </form>
                  )}

                  {isAdmin && item.status === "accepted" && !item.osint_case_exists && (
                    <div className="stack-sm rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                      <div><h4 className="m-0">{t("createOsintCase")}</h4><p className="fine-print mt-1">{t("researcherSafetyLong")}</p></div>
                      {caseFormId !== item.id ? <button className="button button-secondary w-fit" type="button" onClick={() => { setCaseFormId(item.id); setCaseTitle(""); setCaseBrief(""); setCaseObjective(""); setCaseSources(""); }}>{t("prepareResearchTask")}</button> : (
                        <form className="form-stack" onSubmit={(event) => void publishCase(event, item)}>
                          <label>{t("caseTitle")}<input required minLength={3} maxLength={160} value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} /></label>
                          <label>{t("safeBrief")}<textarea required minLength={10} maxLength={5000} rows={3} value={caseBrief} onChange={(event) => setCaseBrief(event.target.value)} placeholder={t("safeBriefPlaceholder")} /></label>
                          <label>{t("researchObjective")}<textarea required minLength={10} maxLength={1000} rows={2} value={caseObjective} onChange={(event) => setCaseObjective(event.target.value)} placeholder={t("objectivePlaceholder")} /></label>
                          <label>{t("allowedSources")} <span className="muted font-normal">({t("sourceDomainsHint")})</span><textarea dir="ltr" required rows={3} value={caseSources} onChange={(event) => setCaseSources((event.target.value))} placeholder={t("sourceDomainsPlaceholder")} /></label>
                          <div className="notice notice-caution">{t("noPersonalResearch")}</div>
                          <div className="flex flex-wrap gap-2"><button className="button button-primary" type="submit" disabled={workingId === item.id}>{workingId === item.id ? t("creating") : t("publishCaseToPool")}</button><button className="button button-secondary" type="button" onClick={() => setCaseFormId(null)}>{t("cancel")}</button></div>
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
            <div><p className="eyebrow">{t("reviewerRole")}</p><h2 id="publication-queue-title" className="m-0">{t("publicationReview")}</h2></div>
            <button className="button button-secondary" type="button" onClick={() => void loadPublicationQueue()} disabled={loadingPublication}>{t("refresh")}</button>
          </div>
          <p className="muted">{t("independentReviewIntro")}</p>
          {loadingPublication ? <p className="muted">{t("loadingApplications")}</p> :
            publicationItems.length === 0 ? <div className="empty-state"><h3>{t("noWarningsPending")}</h3><p>{t("independentReviewIntro")}</p></div> :
              publicationItems.map((item) => (
                <article className="review-card" key={item.indicator_id}>
                  <div className="review-card-heading"><div><p className="eyebrow"><bdi dir="ltr">{item.report_ref}</bdi> · {t(CATEGORY_TRANSLATIONS[item.category] ?? "other")}</p><h3>{t("maskedIndicatorTitle")} <bdi dir="ltr">{item.indicator_masked}</bdi></h3></div><span className="status-pill status-caution">{t("independentReview")}</span></div>
                  <p className="text-sm text-slate-700">{t("verifiedBySource")} <a dir="ltr" href={item.verification_source_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{item.verification_source_url}</a></p>
                  <p className="narrative rounded-lg bg-slate-50 p-4 text-slate-800">{item.verification_note}</p>
                  <label>{t("yourIndependentSource")}
                    <input type="url" dir="ltr" required maxLength={2048} value={reviewUrls[item.indicator_id] ?? ""} onChange={(event) => setReviewUrls((current) => ({ ...current, [item.indicator_id]: event.target.value }))} placeholder="https://official.example.gov.pk/notice" />
                  </label>
                  <label>{t("independentReviewNote")}
                    <textarea minLength={10} maxLength={1000} rows={3} value={reviewNotes[item.indicator_id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [item.indicator_id]: event.target.value }))} placeholder={t("reviewSupportsOrContradicts")} />
                  </label>
                  <label>{t("confidenceCorroboration")} {confidenceById[item.indicator_id] ?? 70}%
                    <input type="range" min={50} max={90} step={5} value={confidenceById[item.indicator_id] ?? 70} onChange={(event) => setConfidenceById((current) => ({ ...current, [item.indicator_id]: Number(event.target.value) }))} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button className="button button-primary" type="button" disabled={workingId === item.indicator_id} onClick={() => void decidePublication(item, "approved")}>{workingId === item.indicator_id ? t("saving") : t("approvePublish")}</button>
                    <button className="button button-secondary" type="button" disabled={workingId === item.indicator_id} onClick={() => void decidePublication(item, "rejected")}>{t("rejectPublication")}</button>
                  </div>
                </article>
              ))}
        </section>
      )}

      <div id="team-chat" className="scroll-mt-6"><TeamChat /></div>
    </section>
  );
}
