import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <main>
      <section className="hero page-shell">
        <div className="hero-copy">
          <p className="eyebrow">A public-interest safety service</p>
          <h1>Pause. Check. Report safely.</h1>
          <p className="lead">Send a scam report without creating an account, or check a suspicious link before you open it. Keep the private reference to track status.</p>
          <div className="button-row"><Link className="button button-primary" to="/citizen/report">Report a scam</Link><Link className="button button-secondary" to="/citizen/track">Track a report</Link></div>
        </div>
        <div className="hero-panel">
          <p className="eyebrow">A careful signal</p>
          <p className="hero-quote">A report is a lead for review, not a finding of guilt.</p>
          <ul className="check-list"><li>Private intake</li><li>Human review</li><li>Clear uncertainty and expiry</li></ul>
        </div>
      </section>
      <section className="page-shell info-grid" aria-label="How ClutterShield works">
        <article className="info-card"><span className="step-number">01</span><h2>Report what happened</h2><p>Provide the suspicious link or number and a short account of the message. Leave out passwords, PINs, OTPs, and unrelated identity documents.</p></article>
        <article className="info-card"><span className="step-number">02</span><h2>Review comes first</h2><p>Authorized reviewers check context and evidence. A submission does not create a public accusation.</p></article>
        <article className="info-card"><span className="step-number">03</span><h2>Get a safer next step</h2><p>Use official bank, wallet, provider, police, or NCCIA channels when you need urgent help or to dispute a payment.</p></article>
      </section>
      <section className="page-shell pb-12 pt-0">
        <div className="info-card flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="eyebrow">For students and researchers</p><h2 className="m-0">Join the OSINT research team</h2><p className="muted mt-2">Create a citizen account, apply, and wait for administrator approval before accessing cases.</p></div>
          <Link className="button button-secondary shrink-0" to="/auth">Create account / sign in</Link>
        </div>
      </section>
    </main>
  );
}
