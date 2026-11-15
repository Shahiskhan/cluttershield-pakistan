import { useCallback, useEffect, useState } from "react";
import {
  getAnalystApplicationQueue,
  reviewAnalystApplication,
  type AnalystApplicationQueueItem,
} from "../../services/analystOnboardingService";
import { useLanguage } from "../../context/LanguageContext";

export function AnalystApplicationsPanel({ onPendingCount }: { onPendingCount?: (count: number) => void }) {
  const { t, language } = useLanguage();
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
      setError(t("applicationQueueError"));
    } finally {
      setLoading(false);
    }
  }, [onPendingCount, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const decide = async (item: AnalystApplicationQueueItem, decision: "approved" | "rejected") => {
    if (decision === "rejected" && (notes[item.id]?.trim().length ?? 0) < 10) {
      setError(t("reviewerNoteRequired"));
      return;
    }
    setWorkingId(item.id);
    setError("");
    setNotice("");
    try {
      await reviewAnalystApplication(item.id, decision, notes[item.id] ?? "");
      setNotice(decision === "approved" ? t("applicationDecisionSaved") : t("applicationDeclined"));
      await refresh();
    } catch {
      setError(t("applicationDecisionError"));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="stack-md" aria-labelledby="researcher-applications-title">
      <div className="section-title-row">
        <div><p className="eyebrow">{t("platformAdministrator")}</p><h2 id="researcher-applications-title" className="m-0">{t("researcherApplications")}</h2></div>
        <button className="button button-secondary" type="button" disabled={loading} onClick={() => void refresh()}>{t("refresh")}</button>
      </div>
      <p className="fine-print">{t("reviewExperienceNoIdentity")}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice notice-success" role="status">{notice}</p>}
      {loading ? <p className="muted">{t("loadingApplications")}</p> : items.length === 0 ?
        <div className="empty-state"><h3>{t("noPendingResearchers")}</h3><p>{t("newRequestsAppear")}</p></div> :
        items.map((item) => (
          <article className="review-card" key={item.id}>
            <div className="review-card-heading"><div><p className="eyebrow">{t("requestResearcherVerification")}</p><h3>{item.full_name}</h3></div><span className="status-pill status-caution">{t("applicationPending")}</span></div>
            <p className="fine-print">{t("submittedAt")} {new Date(item.submitted_at).toLocaleString(language === "ur" ? "ur-PK" : "en-PK")}{item.affiliation ? ` · ${item.affiliation}` : ""}</p>
            {item.portfolio_url && <p className="text-sm"><a dir="ltr" href={item.portfolio_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("publicPortfolio")}</a></p>}
            <p className="narrative rounded-lg bg-slate-50 p-4 text-slate-800">{item.motivation}</p>
            <label>{t("addReviewerNote")} <span className="muted font-normal">({t("requiredWhenDeclining")})</span>
              <textarea maxLength={1000} rows={2} value={notes[item.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={t("reviewerNotePlaceholder")} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="button button-primary" type="button" disabled={workingId === item.id} onClick={() => void decide(item, "approved")}>{workingId === item.id ? t("sendingRequest") : t("approveResearcher")}</button>
              <button className="button button-secondary" type="button" disabled={workingId === item.id || (notes[item.id]?.trim().length ?? 0) < 10} onClick={() => void decide(item, "rejected")}>{t("declineApplication")}</button>
            </div>
          </article>
        ))}
    </section>
  );
}
