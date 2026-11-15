import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";

export function HomePage() {
  const { t } = useLanguage();
  return (
    <main>
      <section className="hero page-shell">
        <div className="hero-copy">
          <p className="eyebrow">{t("publicSafety")}</p>
          <h1>{t("heroTitle")}</h1>
          <p className="lead">{t("heroLead")}</p>
          <div className="button-row"><Link className="button button-primary" to="/citizen/report">{t("reportNow")}</Link><Link className="button button-secondary" to="/citizen/track">{t("trackReport")}</Link></div>
        </div>
        <div className="hero-panel">
          <p className="eyebrow">{t("carefulSignal")}</p>
          <p className="hero-quote">{t("heroQuote")}</p>
          <ul className="check-list"><li>{t("privateIntake")}</li><li>{t("humanReview")}</li><li>{t("clearUncertainty")}</li></ul>
        </div>
      </section>
      <section className="page-shell info-grid" aria-label={t("howItWorks")}>
        <article className="info-card"><span className="step-number">01</span><h2>{t("stepReportTitle")}</h2><p>{t("stepReportBody")}</p></article>
        <article className="info-card"><span className="step-number">02</span><h2>{t("stepReviewTitle")}</h2><p>{t("stepReviewBody")}</p></article>
        <article className="info-card"><span className="step-number">03</span><h2>{t("stepNextTitle")}</h2><p>{t("stepNextBody")}</p></article>
      </section>
      <section className="page-shell safety-section" aria-labelledby="safety-guidelines-title">
        <div className="safety-heading"><p className="eyebrow">{t("brand")}</p><h2 id="safety-guidelines-title">{t("safetyTitle")}</h2><p className="muted">{t("safetyIntro")}</p></div>
        <div className="safety-grid">
          <article className="info-card"><h3>{t("safetyReportTitle")}</h3><p>{t("safetyReportBody")}</p></article>
          <article className="info-card"><h3>{t("safetyEvidenceTitle")}</h3><p>{t("safetyEvidenceBody")}</p></article>
          <article className="info-card"><h3>{t("safetyPrivacyTitle")}</h3><p>{t("safetyPrivacyBody")}</p></article>
          <article className="info-card safety-warning"><h3>{t("safetyNeverTitle")}</h3><p>{t("safetyNeverBody")}</p></article>
        </div>
        <p className="notice notice-caution mt-5">{t("safetyEmergency")}</p>
      </section>
      <section className="page-shell pb-12 pt-0">
        <div className="info-card flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="eyebrow">{t("researchers")}</p><h2 className="m-0">{t("joinOsint")}</h2><p className="muted mt-2">{t("researcherIntro")}</p></div>
          <Link className="button button-secondary shrink-0" to="/auth?mode=signup&amp;next=%2Fresearcher">{t("accountAction")}</Link>
        </div>
      </section>
    </main>
  );
}
