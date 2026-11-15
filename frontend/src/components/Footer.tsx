import { useLanguage } from "../context/LanguageContext";

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="site-footer">
      <div className="page-shell footer-inner">
        <p>{t("footerPurpose")}</p>
        <p>{t("footerSecrets")}</p>
      </div>
    </footer>
  );
}
