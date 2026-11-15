import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { TeamChat } from "../../components/collaboration/TeamChat";
import { StatusPill } from "../../components/StatusPill";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import type { TranslationKey } from "../../i18n/translations";
import {
  getAnalystWorkspace,
  getMentorReviewQueue,
  requestCaseClaim,
  reviewFinding,
  submitFinding,
  type AnalystWorkspace,
  type FindingSourceInput,
} from "../../services/analystService";
import type { AnalystClaim, MentorFinding } from "../../types";

const EMPTY_WORKSPACE: AnalystWorkspace = {
  available: [],
  my_claims: [],
  profile: { accepted_findings: 0, reputation_points: 0, badges: [] },
};
const PROHIBITED_ACTIONS: Record<string, TranslationKey> = {
  intrusion: "prohibitedIntrusion",
  credential_access: "prohibitedCredentials",
  suspect_contact: "prohibitedContact",
  doxxing: "prohibitedDoxxing",
};

export function HackerWorkspace() {
  const { roles } = useAuth();
  const { t, language } = useLanguage();
  const canAnalyze = roles.includes("analyst");
  const canMentor = roles.includes("mentor") || roles.includes("senior_reviewer");
  const [workspace, setWorkspace] = useState<AnalystWorkspace>(EMPTY_WORKSPACE);
  const [mentorItems, setMentorItems] = useState<MentorFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [conflictsReviewed, setConflictsReviewed] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [mentorFeedback, setMentorFeedback] = useState<Record<string, string>>({});

  const load = async () => {
    setError("");
    setLoading(true);
    const analystRequest = canAnalyze ? getAnalystWorkspace() : Promise.resolve(null);
    const mentorRequest = canMentor ? getMentorReviewQueue() : Promise.resolve(null);
    const results = await Promise.allSettled([analystRequest, mentorRequest]);
    if (canAnalyze) {
      if (results[0].status === "fulfilled" && results[0].value) {
        setWorkspace(results[0].value);
      } else {
        setError(t("analystWorkspaceUnavailable"));
      }
    }
    if (canMentor) {
      if (results[1].status === "fulfilled" && results[1].value) {
        setMentorItems(results[1].value);
      } else {
        setError((current) => current ? current + t("mentorQueueAlsoUnavailable") : t("mentorQueueUnavailable"));
      }
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [canAnalyze, canMentor, t]);

  const claimCase = async (caseId: string) => {
    setWorkingId(caseId);
    setError("");
    try {
      await requestCaseClaim(caseId, conflictsReviewed);
      await load();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "analyst_capacity_reached"
        ? t("activeCaseLimit")
        : code === "capacity_reached"
          ? t("caseSlotTaken")
          : code === "not_available"
            ? t("caseNoLongerAvailable")
            : t("caseClaimFailed"));
    } finally {
      setWorkingId(null);
    }
  };

  const submitNotebook = async (claim: AnalystClaim, submission: {
    summary: string;
    sources: FindingSourceInput[];
    confidence: number;
    limitations: string;
  }) => {
    setWorkingId(claim.assignment_id);
    setError("");
    try {
      await submitFinding({ assignmentId: claim.assignment_id, ...submission });
      await load();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "assignment_scope_required"
        ? t("assignmentExpired")
        : code === "finding_already_submitted"
          ? t("findingAlreadySubmitted")
        : code === "invalid_finding"
          ? t("findingInvalid")
          : t("findingSubmitError"));
      throw cause;
    } finally {
      setWorkingId(null);
    }
  };

  const decideFinding = async (item: MentorFinding, decision: "accepted" | "changes_requested") => {
    const feedback = mentorFeedback[item.finding_id]?.trim() ?? "";
    if (feedback.length < 10) {
      setError(t("reviewerNoteNeeded"));
      return;
    }
    setWorkingId(item.finding_id);
    setError("");
    try {
      await reviewFinding({ findingId: item.finding_id, decision, feedback });
      await load();
    } catch {
      setError(t("mentorDecisionError"));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="stack-lg">
      <div className="notice notice-caution">
        <strong>{t("publicResearchOnly")}</strong> {t("researcherSafetyLong")}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      {canAnalyze && (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label={t("researcherPortal")}>
            <div className="info-card"><p className="eyebrow">{t("reputation")}</p><strong className="text-3xl">{workspace.profile.reputation_points}</strong><p className="muted mb-0">{t("reviewedContributions")}</p></div>
            <div className="info-card"><p className="eyebrow">{t("acceptedFindings")}</p><strong className="text-3xl">{workspace.profile.accepted_findings}</strong><p className="muted mb-0">{t("mentorAccepted")}</p></div>
            <div className="info-card"><p className="eyebrow">{t("badges")}</p>{workspace.profile.badges.length ? <ul className="m-0 flex flex-wrap gap-2 p-0">{workspace.profile.badges.map((badge) => <li key={badge} className="list-none rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{badge}</li>)}</ul> : <p className="muted mb-0">{t("badgesEarned")}</p>}</div>
          </section>

          <section className="stack-md" aria-labelledby="case-pool-title">
            <div className="section-title-row"><div><p className="eyebrow">{t("guild")}</p><h2 id="case-pool-title" className="m-0">{t("openCases")}</h2></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>{t("refresh")}</button></div>
            <p className="fine-print">{t("claimsTimer")}</p>
            {loading ? <p className="muted">{t("loadingCases")}</p> :
              workspace.available.length === 0 ? <div className="empty-state"><h3>{t("noCases")}</h3><p>{t("sanitizedCasesOnly")}</p></div> :
                <>
                  <label className="checkbox-label scope-confirm"><input type="checkbox" checked={conflictsReviewed} onChange={(event) => setConflictsReviewed(event.target.checked)} /><span>{t("conflictConfirm")}</span></label>
                  {workspace.available.map((item) => (
                    <article className="case-card" key={item.id}>
                      <div className="review-card-heading"><div><p className="eyebrow">{item.case_ref}</p><h3>{item.title}</h3></div><StatusPill status={item.state} /></div>
                      <p>{item.brief}</p><p><strong>{t("researchQuestion")}</strong> {item.objective}</p>
                      <div className="case-columns">
                        <div><h4>{t("allowedSources")}</h4><ul>{item.allowed_sources.map((source) => <li key={source} dir="ltr">{source}</li>)}</ul></div>
                        <div><h4>{t("prohibitedActions")}</h4><ul>{item.prohibited_actions.map((action) => <li key={action}>{PROHIBITED_ACTIONS[action] ? t(PROHIBITED_ACTIONS[action]) : action.replaceAll("_", " ")}</li>)}</ul></div>
                      </div>
                      {item.deadline_at && <p className="fine-print">{t("caseDeadline")}: {formatDate(item.deadline_at, language)}</p>}
                      <button className="button button-primary" type="button" disabled={!conflictsReviewed || workingId === item.id} onClick={() => void claimCase(item.id)}>
                        {workingId === item.id ? t("claimingCase") : t("claimCase")}
                      </button>
                    </article>
                  ))}
                </>
            }
          </section>

          <section className="stack-md" aria-labelledby="my-cases-title">
            <div><p className="eyebrow">{t("myCases")}</p><h2 id="my-cases-title" className="m-0">{t("investigationNotebook")}</h2></div>
            {workspace.my_claims.length === 0 ? <div className="empty-state"><p>{t("noAssignments")}</p></div> :
              workspace.my_claims.map((claim) => (
                <ClaimWorkspace key={claim.assignment_id} claim={claim} busy={workingId === claim.assignment_id} onSubmit={(value) => submitNotebook(claim, value)} />
              ))}
          </section>
        </>
      )}

      {canMentor && (
        <section className="stack-md" aria-labelledby="mentor-review-title">
          <div><p className="eyebrow">{t("mentorReview")}</p><h2 id="mentor-review-title" className="m-0">{t("submittedContributions")}</h2></div>
          {loading ? <p className="muted">{t("loadingApplications")}</p> :
            mentorItems.length === 0 ? <div className="empty-state"><p>{t("noCasesWait")}</p></div> :
              mentorItems.map((item) => (
                <article className="case-card" key={item.finding_id}>
                  <div className="review-card-heading"><div><p className="eyebrow">{item.case_ref} · {item.analyst_label}</p><h3>{item.case_title}</h3></div><StatusPill status={item.review_state} /></div>
                  <p className="narrative">{item.summary}</p>
                  <div><h4>{t("sourceTimes")}</h4><ul className="grid gap-2">
                    {item.sources.map((source) => <li key={source.url + source.observed_at} className="break-all text-sm"><a dir="ltr" href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.url}</a><span className="block text-xs text-slate-500">{t("observed")} {formatDate(source.observed_at, language)}</span></li>)}
                  </ul></div>
                  <p className="text-sm"><strong>{t("confidence")}:</strong> {item.confidence}%</p>
                  <p className="text-sm"><strong>{t("limitations")}:</strong> {item.limitations}</p>
                  <label>{t("mentorFeedback")}
                    <textarea minLength={10} maxLength={1000} rows={3} value={mentorFeedback[item.finding_id] ?? ""} onChange={(event) => setMentorFeedback((current) => ({ ...current, [item.finding_id]: event.target.value }))} placeholder={t("reviewerNote") + " " + t("doNotAskSecrets")} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button className="button button-primary" type="button" disabled={workingId === item.finding_id} onClick={() => void decideFinding(item, "accepted")}>{t("acceptContribution")}</button>
                    <button className="button button-secondary" type="button" disabled={workingId === item.finding_id} onClick={() => void decideFinding(item, "changes_requested")}>{t("requestChanges")}</button>
                  </div>
                </article>
              ))}
        </section>
      )}

      <TeamChat />
    </section>
  );
}

function ClaimWorkspace({ claim, busy, onSubmit }: {
  claim: AnalystClaim;
  busy: boolean;
  onSubmit: (submission: { summary: string; sources: FindingSourceInput[]; confidence: number; limitations: string }) => Promise<void>;
}) {
  const { t, language } = useLanguage();
  const [, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const isExpired = !claim.expires_at || Date.parse(claim.expires_at) <= Date.now();
  const isActiveState = ["assigned", "in_progress", "findings_submitted"].includes(claim.state);
  const canWork = isActiveState && !isExpired;
  const canSubmit = canWork && claim.latest_finding?.review_state !== "submitted" && claim.latest_finding?.review_state !== "accepted";
  const statusLabel = isExpired && isActiveState ? "expired" : claim.latest_finding?.review_state ?? claim.state;
  return (
    <article className="case-card">
      <div className="review-card-heading"><div><p className="eyebrow">{claim.case_ref}</p><h3>{claim.title}</h3></div><StatusPill status={statusLabel} /></div>
      {claim.expires_at && <p className="fine-print">{t("assignmentExpiry")} {isExpired ? t("statusExpired") : t("assignmentEnds")} {formatDate(claim.expires_at, language)}{!isExpired ? " · " + timeRemaining(claim.expires_at) + " " + t("remaining") : ""}</p>}
      {claim.latest_finding?.review_state === "submitted" && <p className="notice">{t("awaitingMentor")}</p>}
      {claim.latest_finding?.review_state === "accepted" && <p className="notice notice-success">{t("findingAcceptedNotice")}</p>}
      {claim.latest_finding?.review_state === "changes_requested" && <div className="notice notice-caution"><strong>{t("mentorFeedback")}:</strong> {claim.latest_finding.mentor_feedback}</div>}
      {canSubmit && <FindingNotebook busy={busy} resubmission={claim.latest_finding?.review_state === "changes_requested"} onSubmit={onSubmit} />}
      {!canWork && <p className="muted mb-0">{t("assignmentNoLongerActive")}</p>}
    </article>
  );
}

function FindingNotebook({ busy, resubmission, onSubmit }: {
  busy: boolean;
  resubmission: boolean;
  onSubmit: (submission: { summary: string; sources: FindingSourceInput[]; confidence: number; limitations: string }) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [summary, setSummary] = useState("");
  const [limitations, setLimitations] = useState("");
  const [confidence, setConfidence] = useState(60);
  const [passiveConfirmed, setPassiveConfirmed] = useState(false);
  const [sources, setSources] = useState(() => [{ key: crypto.randomUUID(), url: "", observedAt: currentLocalDateTime() }]);
  const [submitError, setSubmitError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError("");
    const normalized: FindingSourceInput[] = [];
    for (const source of sources) {
      const observedAt = new Date(source.observedAt);
      if (!source.url.trim() || Number.isNaN(observedAt.getTime())) {
        setSubmitError(t("sourceTimeRequired"));
        return;
      }
      normalized.push({ url: source.url.trim(), observedAt: observedAt.toISOString() });
    }
    try {
      await onSubmit({ summary: summary.trim(), limitations: limitations.trim(), confidence, sources: normalized });
    } catch {
      setSubmitError(t("notebookInvalid"));
    }
  };

  return (
    <form className="form-card border border-slate-200 bg-slate-50/70" onSubmit={submit}>
      <h4 className="m-0">{resubmission ? t("reviseNotebook") : t("investigationNotebookEntry")}</h4>
      <p className="fine-print">{t("researcherSafetyLong")}</p>
      <label>{t("findingSummary")}
        <textarea required minLength={10} maxLength={2000} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={t("findingSummaryPlaceholder")} />
      </label>
      <fieldset className="grid gap-3 border-0 p-0">
        <legend className="mb-2 text-sm font-bold">{t("sourceTimes")}</legend>
        {sources.map((source, index) => (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_230px_auto]" key={source.key}>
            <label>{t("sourceUrl")} {index + 1}
              <input type="url" dir="ltr" required maxLength={2048} value={source.url} onChange={(event) => setSources((current) => current.map((item) => item.key === source.key ? { ...item, url: event.target.value } : item))} placeholder="https://public.example.org/notice" />
            </label>
            <label>{t("observedAt")}
              <input type="datetime-local" dir="ltr" required value={source.observedAt} onChange={(event) => setSources((current) => current.map((item) => item.key === source.key ? { ...item, observedAt: event.target.value } : item))} />
            </label>
            {sources.length > 1 && <button className="button button-secondary self-end" type="button" onClick={() => setSources((current) => current.filter((item) => item.key !== source.key))}>{t("remove")}</button>}
          </div>
        ))}
        {sources.length < 10 && <button className="button button-secondary w-fit" type="button" onClick={() => setSources((current) => [...current, { key: crypto.randomUUID(), url: "", observedAt: currentLocalDateTime() }])}>{t("addSource")}</button>}
      </fieldset>
      <label>{t("confidenceResearch")} {confidence}%
        <input type="range" min={0} max={100} step={5} value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
      </label>
      <label>{t("limitations")}
        <textarea required minLength={10} maxLength={1000} rows={3} value={limitations} onChange={(event) => setLimitations(event.target.value)} placeholder={t("limitationsPlaceholder")} />
      </label>
      <label className="checkbox-label"><input type="checkbox" checked={passiveConfirmed} onChange={(event) => setPassiveConfirmed(event.target.checked)} required /><span>{t("confirmPassive")}</span></label>
      {submitError && <p className="form-error" role="alert">{submitError}</p>}
      <button className="button button-primary w-fit" type="submit" disabled={busy || !passiveConfirmed}>{busy ? t("submitting") : resubmission ? t("resubmitFinding") : t("submitFinding")}</button>
    </form>
  );
}

function currentLocalDateTime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function formatDate(value: string, language: "en" | "ur"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (language === "ur" ? "دستیاب نہیں" : "Unavailable") : date.toLocaleString(language === "ur" ? "ur-PK" : "en-PK");
}

function timeRemaining(value: string): string {
  const remaining = Math.max(0, Date.parse(value) - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return hours > 0 ? hours + "h " + minutes + "m" : minutes + "m";
}
