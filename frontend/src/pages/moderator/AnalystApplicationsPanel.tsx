import { useCallback, useEffect, useState } from "react";
import {
  getAnalystApplicationQueue,
  reviewAnalystApplication,
  type AnalystApplicationQueueItem,
} from "../../services/analystOnboardingService";

export function AnalystApplicationsPanel({ onPendingCount }: { onPendingCount?: (count: number) => void }) {
  const [items, setItems] = useState<AnalystApplicationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextItems = await getAnalystApplicationQueue();
      setItems(nextItems);
      onPendingCount?.(nextItems.length);
      setError("");
    } catch {
      setError("The researcher application queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const decide = async (item: AnalystApplicationQueueItem, decision: "approved" | "rejected") => {
    if (decision === "rejected" && (notes[item.id]?.trim().length ?? 0) < 10) {
      setError("Add a short reviewer note before declining an application.");
      return;
    }
    setWorkingId(item.id);
    setError("");
    setNotice("");
    try {
      await reviewAnalystApplication(item.id, decision, notes[item.id] ?? "");
      setNotice(decision === "approved" ? "Analyst access granted after review." : "Application declined; the applicant may revise and reapply.");
      await refresh();
    } catch {
      setError("The application decision was not saved. It may have already been reviewed.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="stack-md" aria-labelledby="researcher-applications-title">
      <div className="section-title-row">
        <div><p className="eyebrow">Platform administrator</p><h2 id="researcher-applications-title" className="m-0">Researcher applications</h2></div>
        <button className="button button-secondary" type="button" disabled={loading} onClick={() => void refresh()}>Refresh</button>
      </div>
      <p className="fine-print">Approval grants only the analyst role. Review experience and public portfolio information; do not request identity documents, passwords, or OTPs.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice notice-success" role="status">{notice}</p>}
      {loading ? <p className="muted">Loading applications…</p> : items.length === 0 ?
        <div className="empty-state"><h3>No pending researcher applications</h3><p>New applications submitted after signup will appear here.</p></div> :
        items.map((item) => (
          <article className="review-card" key={item.id}>
            <div className="review-card-heading"><div><p className="eyebrow">Researcher application</p><h3>{item.full_name}</h3></div><span className="status-pill status-caution">Pending</span></div>
            <p className="fine-print">Submitted {new Date(item.submitted_at).toLocaleString()}{item.affiliation ? ` · ${item.affiliation}` : ""}</p>
            {item.portfolio_url && <p className="text-sm"><a href={item.portfolio_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">View public portfolio</a></p>}
            <p className="narrative rounded-lg bg-slate-50 p-4 text-slate-800">{item.motivation}</p>
            <label>Reviewer note <span className="muted font-normal">(required when declining)</span>
              <textarea maxLength={1000} rows={2} value={notes[item.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Keep the note respectful and free of personal information." />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="button button-primary" type="button" disabled={workingId === item.id} onClick={() => void decide(item, "approved")}>{workingId === item.id ? "Saving…" : "Approve analyst access"}</button>
              <button className="button button-secondary" type="button" disabled={workingId === item.id || (notes[item.id]?.trim().length ?? 0) < 10} onClick={() => void decide(item, "rejected")}>Decline application</button>
            </div>
          </article>
        ))}
    </section>
  );
}
