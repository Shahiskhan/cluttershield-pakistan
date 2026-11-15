import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { TeamChat } from "../../components/collaboration/TeamChat";
import { StatusPill } from "../../components/StatusPill";
import { useAuth } from "../../context/AuthContext";
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

export function HackerWorkspace() {
  const { roles } = useAuth();
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
        setError("The analyst workspace is unavailable. Confirm that your analyst role is active.");
      }
    }
    if (canMentor) {
      if (results[1].status === "fulfilled" && results[1].value) {
        setMentorItems(results[1].value);
      } else {
        setError((current) => current ? current + " Mentor review queue is also unavailable." : "The mentor review queue is unavailable.");
      }
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [canAnalyze, canMentor]);

  const claimCase = async (caseId: string) => {
    setWorkingId(caseId);
    setError("");
    try {
      await requestCaseClaim(caseId, conflictsReviewed);
      await load();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "analyst_capacity_reached"
        ? "You already have two active cases. Finish or let one expire before claiming another."
        : code === "capacity_reached"
          ? "Another analyst claimed the remaining slot first. Refresh the case pool."
          : code === "not_available"
            ? "This case is no longer available."
            : "The case claim could not be saved.");
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
        ? "This case assignment has expired or is no longer active."
        : code === "finding_already_submitted"
          ? "Your current finding is already awaiting review or has been accepted."
        : code === "invalid_finding"
          ? "The finding contains invalid source data or possible citizen contact details. Review it and try again."
          : "The finding could not be submitted.");
      throw cause;
    } finally {
      setWorkingId(null);
    }
  };

  const decideFinding = async (item: MentorFinding, decision: "accepted" | "changes_requested") => {
    const feedback = mentorFeedback[item.finding_id]?.trim() ?? "";
    if (feedback.length < 10) {
      setError("Add at least a short, specific review note before deciding.");
      return;
    }
    setWorkingId(item.finding_id);
    setError("");
    try {
      await reviewFinding({ findingId: item.finding_id, decision, feedback });
      await load();
    } catch {
      setError("The mentor decision could not be recorded. The finding may already have been reviewed.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="stack-lg">
      <div className="notice notice-caution">
        <strong>Passive public-source research only.</strong> Do not access accounts or systems, use credentials, contact a subject, collect private records, publish personal information, or go beyond the written case scope. Never place citizen identifiers in findings or chat.
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      {canAnalyze && (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label="Contribution profile">
            <div className="info-card"><p className="eyebrow">Reputation</p><strong className="text-3xl">{workspace.profile.reputation_points}</strong><p className="muted mb-0">points from reviewed contributions</p></div>
            <div className="info-card"><p className="eyebrow">Accepted findings</p><strong className="text-3xl">{workspace.profile.accepted_findings}</strong><p className="muted mb-0">mentor-accepted submissions</p></div>
            <div className="info-card"><p className="eyebrow">Badges</p>{workspace.profile.badges.length ? <ul className="m-0 flex flex-wrap gap-2 p-0">{workspace.profile.badges.map((badge) => <li key={badge} className="list-none rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{badge}</li>)}</ul> : <p className="muted mb-0">Badges are earned through reviewed work.</p>}</div>
          </section>

          <section className="stack-md" aria-labelledby="case-pool-title">
            <div className="section-title-row"><div><p className="eyebrow">Guild</p><h2 id="case-pool-title" className="m-0">Open case pool</h2></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh</button></div>
            <p className="fine-print">Claims reserve a case for up to 24 hours (or until its deadline). Each analyst may hold at most two active cases. A case-specific team room opens while the assignment is active.</p>
            {loading ? <p className="muted">Loading approved case briefs…</p> :
              workspace.available.length === 0 ? <div className="empty-state"><h3>No cases are available</h3><p>Only sanitized, approved briefs appear in this pool.</p></div> :
                <>
                  <label className="checkbox-label scope-confirm"><input type="checkbox" checked={conflictsReviewed} onChange={(event) => setConflictsReviewed(event.target.checked)} /><span>I reviewed conflicts and can follow the case scope and prohibited actions.</span></label>
                  {workspace.available.map((item) => (
                    <article className="case-card" key={item.id}>
                      <div className="review-card-heading"><div><p className="eyebrow">{item.case_ref}</p><h3>{item.title}</h3></div><StatusPill status={item.state} /></div>
                      <p>{item.brief}</p><p><strong>Research question:</strong> {item.objective}</p>
                      <div className="case-columns">
                        <div><h4>Allowed public sources</h4><ul>{item.allowed_sources.map((source) => <li key={source}>{source}</li>)}</ul></div>
                        <div><h4>Prohibited actions</h4><ul>{item.prohibited_actions.map((action) => <li key={action}>{action.replaceAll("_", " ")}</li>)}</ul></div>
                      </div>
                      {item.deadline_at && <p className="fine-print">Case deadline: {formatDate(item.deadline_at)}</p>}
                      <button className="button button-primary" type="button" disabled={!conflictsReviewed || workingId === item.id} onClick={() => void claimCase(item.id)}>
                        {workingId === item.id ? "Claiming…" : "Claim case"}
                      </button>
                    </article>
                  ))}
                </>
            }
          </section>

          <section className="stack-md" aria-labelledby="my-cases-title">
            <div><p className="eyebrow">Assigned to me</p><h2 id="my-cases-title" className="m-0">Investigation notebook</h2></div>
            {workspace.my_claims.length === 0 ? <div className="empty-state"><p>You have no current case assignments.</p></div> :
              workspace.my_claims.map((claim) => (
                <ClaimWorkspace key={claim.assignment_id} claim={claim} busy={workingId === claim.assignment_id} onSubmit={(value) => submitNotebook(claim, value)} />
              ))}
          </section>
        </>
      )}

      {canMentor && (
        <section className="stack-md" aria-labelledby="mentor-review-title">
          <div><p className="eyebrow">Mentor review</p><h2 id="mentor-review-title" className="m-0">Submitted contributions</h2></div>
          {loading ? <p className="muted">Loading findings for review…</p> :
            mentorItems.length === 0 ? <div className="empty-state"><p>No findings are waiting for mentor review.</p></div> :
              mentorItems.map((item) => (
                <article className="case-card" key={item.finding_id}>
                  <div className="review-card-heading"><div><p className="eyebrow">{item.case_ref} · {item.analyst_label}</p><h3>{item.case_title}</h3></div><StatusPill status={item.review_state} /></div>
                  <p className="narrative">{item.summary}</p>
                  <div><h4>Source URLs and observation times</h4><ul className="grid gap-2">
                    {item.sources.map((source) => <li key={source.url + source.observed_at} className="break-all text-sm"><a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.url}</a><span className="block text-xs text-slate-500">Observed {formatDate(source.observed_at)}</span></li>)}
                  </ul></div>
                  <p className="text-sm"><strong>Analyst confidence:</strong> {item.confidence}%</p>
                  <p className="text-sm"><strong>Limitations:</strong> {item.limitations}</p>
                  <label>Mentor feedback
                    <textarea minLength={10} maxLength={1000} rows={3} value={mentorFeedback[item.finding_id] ?? ""} onChange={(event) => setMentorFeedback((current) => ({ ...current, [item.finding_id]: event.target.value }))} placeholder="Give a scoped, constructive note. Do not include personal identifiers." />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button className="button button-primary" type="button" disabled={workingId === item.finding_id} onClick={() => void decideFinding(item, "accepted")}>Accept contribution</button>
                    <button className="button button-secondary" type="button" disabled={workingId === item.finding_id} onClick={() => void decideFinding(item, "changes_requested")}>Request changes</button>
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
      {claim.expires_at && <p className="fine-print">Assignment {isExpired ? "expired" : "ends"} {formatDate(claim.expires_at)}{!isExpired ? " · " + timeRemaining(claim.expires_at) + " remaining" : ""}</p>}
      {claim.latest_finding?.review_state === "submitted" && <p className="notice">Your latest finding is awaiting mentor review.</p>}
      {claim.latest_finding?.review_state === "accepted" && <p className="notice notice-success">Your finding was accepted. It remains a research contribution, not a legal finding.</p>}
      {claim.latest_finding?.review_state === "changes_requested" && <div className="notice notice-caution"><strong>Mentor feedback:</strong> {claim.latest_finding.mentor_feedback}</div>}
      {canSubmit && <FindingNotebook busy={busy} resubmission={claim.latest_finding?.review_state === "changes_requested"} onSubmit={onSubmit} />}
      {!canWork && <p className="muted mb-0">This assignment is no longer active. It will not accept findings or grant case-room access.</p>}
    </article>
  );
}

function FindingNotebook({ busy, resubmission, onSubmit }: {
  busy: boolean;
  resubmission: boolean;
  onSubmit: (submission: { summary: string; sources: FindingSourceInput[]; confidence: number; limitations: string }) => Promise<void>;
}) {
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
        setSubmitError("Add a valid public source URL and observation time for every entry.");
        return;
      }
      normalized.push({ url: source.url.trim(), observedAt: observedAt.toISOString() });
    }
    try {
      await onSubmit({ summary: summary.trim(), limitations: limitations.trim(), confidence, sources: normalized });
    } catch {
      setSubmitError("Review the source URLs, timestamps, and text. Do not include a citizen's name, phone number, email, CNIC, or report reference.");
    }
  };

  return (
    <form className="form-card border border-slate-200 bg-slate-50/70" onSubmit={submit}>
      <h4 className="m-0">{resubmission ? "Revise notebook entry" : "Investigation notebook"}</h4>
      <p className="fine-print">Record only scoped observations from public sources. Do not identify private individuals or include citizen data.</p>
      <label>Structured finding summary
        <textarea required minLength={10} maxLength={2000} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Summarize what the public evidence supports and what remains uncertain." />
      </label>
      <fieldset className="grid gap-3 border-0 p-0">
        <legend className="mb-2 text-sm font-bold">Public source URLs</legend>
        {sources.map((source, index) => (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_230px_auto]" key={source.key}>
            <label>Source {index + 1} URL
              <input type="url" required maxLength={2048} value={source.url} onChange={(event) => setSources((current) => current.map((item) => item.key === source.key ? { ...item, url: event.target.value } : item))} placeholder="https://public.example.org/notice" />
            </label>
            <label>Observed at
              <input type="datetime-local" required value={source.observedAt} onChange={(event) => setSources((current) => current.map((item) => item.key === source.key ? { ...item, observedAt: event.target.value } : item))} />
            </label>
            {sources.length > 1 && <button className="button button-secondary self-end" type="button" onClick={() => setSources((current) => current.filter((item) => item.key !== source.key))}>Remove</button>}
          </div>
        ))}
        {sources.length < 10 && <button className="button button-secondary w-fit" type="button" onClick={() => setSources((current) => [...current, { key: crypto.randomUUID(), url: "", observedAt: currentLocalDateTime() }])}>Add source</button>}
      </fieldset>
      <label>Confidence in this research finding: {confidence}%
        <input type="range" min={0} max={100} step={5} value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
      </label>
      <label>Limitations and uncertainties
        <textarea required minLength={10} maxLength={1000} rows={3} value={limitations} onChange={(event) => setLimitations(event.target.value)} placeholder="Explain gaps, source reliability, and what this finding does not establish." />
      </label>
      <label className="checkbox-label"><input type="checkbox" checked={passiveConfirmed} onChange={(event) => setPassiveConfirmed(event.target.checked)} required /><span>I used only public sources within the case scope. I did not access accounts or systems, contact a subject, collect private records, or include personal information.</span></label>
      {submitError && <p className="form-error" role="alert">{submitError}</p>}
      <button className="button button-primary w-fit" type="submit" disabled={busy || !passiveConfirmed}>{busy ? "Submitting…" : resubmission ? "Resubmit for review" : "Submit finding"}</button>
    </form>
  );
}

function currentLocalDateTime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

function timeRemaining(value: string): string {
  const remaining = Math.max(0, Date.parse(value) - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return hours > 0 ? hours + "h " + minutes + "m" : minutes + "m";
}
