import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

export function Navbar() {
  const { user, roles, signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobileMenu = () => setMobileOpen(false);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" to="/" aria-label={t("brand")}>
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>{t("brand")}</span>
        </Link>
        <button className="mobile-menu-toggle" type="button" aria-label={mobileOpen ? t("closeMenu") : t("openMenu")} aria-expanded={mobileOpen} aria-controls="primary-navigation" onClick={() => setMobileOpen((open) => !open)}>
          <span aria-hidden="true">{mobileOpen ? "×" : "☰"}</span>
        </button>
        <nav id="primary-navigation" className={"header-nav" + (mobileOpen ? " is-open" : "")} aria-label={t("mainNavigation")}>
          <Link to="/citizen/report" onClick={closeMobileMenu}>{t("report")}</Link>
          <Link to="/citizen/track" onClick={closeMobileMenu}>{t("track")}</Link>
          {user && roles.includes("platform_admin") && <Link to="/admin" onClick={closeMobileMenu}>{t("adminPortal")}</Link>}
          {user && !roles.includes("platform_admin") && (roles.includes("moderator") || roles.includes("senior_reviewer")) && <Link to="/moderator" onClick={closeMobileMenu}>{t("reviewConsole")}</Link>}
          {user && !roles.includes("platform_admin") && roles.some((role) => ["citizen", "analyst", "mentor", "senior_reviewer"].includes(role)) && <Link to="/researcher" onClick={closeMobileMenu}>{t("researcherPortal")}</Link>}
          {!user && <Link to={"/auth?mode=signup&next=%2Fresearcher"} onClick={closeMobileMenu}>{t("joinResearcher")}</Link>}
          {user ? <button className="link-button" onClick={() => { closeMobileMenu(); void signOut(); }}>{t("signOut")}</button> : <Link to="/auth" onClick={closeMobileMenu}>{t("signIn")}</Link>}
          <button
            className="language-toggle"
            type="button"
            aria-label={language === "en" ? t("switchToUrdu") : t("switchToEnglish")}
            onClick={() => { setLanguage(language === "en" ? "ur" : "en"); closeMobileMenu(); }}
          >{language === "en" ? "اردو" : "English"}</button>
        </nav>
      </div>
    </header>
  );
}
