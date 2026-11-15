import { useAuth } from "../../context/AuthContext";
import { HackerLayout } from "../../layouts/HackerLayout";
import { CitizenLayout } from "../../layouts/CitizenLayout";
import { AnalystApplicationPage } from "./AnalystApplicationPage";
import { HackerWorkspace } from "../hacker/HackerWorkspace";

export function ResearcherPortal() {
  const { roles, loading } = useAuth();
  if (loading) return <main className="page-shell"><p className="muted">Loading your secure workspace…</p></main>;

  const canResearch = roles.some((role) => ["analyst", "mentor", "senior_reviewer"].includes(role));
  return canResearch
    ? <HackerLayout><HackerWorkspace /></HackerLayout>
    : <CitizenLayout><AnalystApplicationPage /></CitizenLayout>;
}
