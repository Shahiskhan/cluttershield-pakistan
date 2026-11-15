import { useAuth } from "../../context/AuthContext";
import { HackerLayout } from "../../layouts/HackerLayout";
import { CitizenLayout } from "../../layouts/CitizenLayout";
import { AnalystApplicationPage } from "./AnalystApplicationPage";
import { HackerWorkspace } from "../hacker/HackerWorkspace";
import { useLanguage } from "../../context/LanguageContext";

export function ResearcherPortal() {
  const { t } = useLanguage();
  const { roles, loading } = useAuth();
  if (loading) return <main className="page-shell"><p className="muted">{t("authLoading")}</p></main>;

  const canResearch = roles.some((role) => ["analyst", "mentor", "senior_reviewer"].includes(role));
  return canResearch
    ? <HackerLayout><HackerWorkspace /></HackerLayout>
    : <CitizenLayout><AnalystApplicationPage /></CitizenLayout>;
}
