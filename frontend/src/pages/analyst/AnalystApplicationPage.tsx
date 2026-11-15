import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  getMyAnalystApplication,
  submitAnalystApplication,
  type MyAnalystApplication,
} from "../../services/analystOnboardingService";

export function AnalystApplicationPage() {
  const { refreshRoles, roles } = useAuth();
  const [application, setApplication] = useState<MyAnalystApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [motivation, setMotivation] = useState("");

  useEffect(() => {
    let active = true;
    void refreshRoles();
    getMyAnalystApplication()
      .then((result) => { if (active) setApplication(result); })
      .catch(() => { if (active) setError("Your application status could not be loaded. Please refresh and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      setApplication(await submitAnalystApplication({
        fullName,
        affiliation: affiliation || null,
        portfolioUrl: portfolioUrl || null,
        motivation,
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message.includes("already_analyst")
        ? "This account already has analyst access. Open the analyst workspace from the navigation."
        : message.includes("invalid_application")
          ? "Review the fields. Your motivation must be 40–2,000 characters, and the portfolio link must be a public HTTP(S) URL."
          : "The application could not be saved. Check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const refreshAccess = async () => {
    setError("");
    try {
      const [nextApplication] = await Promise.all([getMyAnalystApplication(), refreshRoles()]);
      setApplication(nextApplication);
    } catch {
      setError("Your latest application and access status could not be loaded. Please try again.");
    }
  };

  return (
    <section className="page-shell narrow-shell stack-md">
      <div className="page-heading">
        <p className="eyebrow">Researcher onboarding</p>
        <h1>Request researcher verification</h1>
        <p className="muted mt-3">Submit your public-source research experience for administrator review. Case access stays locked until your request is approved.</p>
      </div>
      {loading ? <p className="muted">Loading your application status…</p> : application ? (
        <article className="result-card items-start text-left">
          <p className="eyebrow">Application status</p>
          <h2 className="capitalize">{application.status}</h2>
          <p className="muted">Submitted {new Date(application.submitted_at).toLocaleString()}.</p>
          {application.status === "approved" && <p className="notice notice-success">{roles.includes("analyst") ? <>Your researcher access is active. <Link className="font-semibold underline" to="/researcher">Open your case pool</Link>.</> : "Your request is approved. Refresh your access status to load the researcher workspace."}</p>}
          {application.status === "pending" && <p className="notice">An administrator will review your request. You cannot claim or view research cases while it is pending.</p>}
          {application.status === "rejected" && <>
            <p className="notice notice-caution">The application was not approved. You may update your information and submit it again.</p>
            {application.reviewer_note && <p className="fine-print">Reviewer note: {application.reviewer_note}</p>}
            <button className="button button-secondary w-fit" type="button" onClick={() => setApplication(null)}>Update and reapply</button>
          </>}
          <button className="button button-secondary w-fit" type="button" onClick={() => void refreshAccess()}>Refresh application and access status</button>
        </article>
      ) : (
        <form className="form-card form-stack" onSubmit={(event) => void submit(event)}>
          <label htmlFor="researcher-name">Full name
            <input id="researcher-name" required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>
          <label htmlFor="researcher-affiliation">University or organization <span className="muted font-normal">(optional)</span>
            <input id="researcher-affiliation" maxLength={120} value={affiliation} onChange={(event) => setAffiliation(event.target.value)} />
          </label>
          <label htmlFor="researcher-portfolio">Public portfolio link <span className="muted font-normal">(optional)</span>
            <input id="researcher-portfolio" type="url" maxLength={2048} placeholder="https://example.org/profile" value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} />
          </label>
          <label htmlFor="researcher-motivation">Relevant experience and why you want to contribute
            <textarea id="researcher-motivation" required minLength={40} maxLength={2000} rows={6} value={motivation} onChange={(event) => setMotivation(event.target.value)} placeholder="Describe public-source research experience, relevant skills, and how you will follow platform rules." />
          </label>
          <div className="notice notice-caution">Research is limited to public sources. No intrusion, credential access, doxxing, collection of private records, or contact with suspected actors is allowed.</div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary w-fit" type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Send verification request"}</button>
        </form>
      )}
    </section>
  );
}
