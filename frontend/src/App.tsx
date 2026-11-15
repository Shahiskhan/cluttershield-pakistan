import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Footer } from "./components/Footer";
import { Navbar } from "./components/Navbar";
import { AuthProvider } from "./context/AuthContext";
import { LanguageProvider, useLanguage } from "./context/LanguageContext";
import { RoleGate } from "./context/RoleGate";
import { CitizenLayout } from "./layouts/CitizenLayout";
import { HackerLayout } from "./layouts/HackerLayout";
import { ModeratorLayout } from "./layouts/ModeratorLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { HackerWorkspace } from "./pages/hacker/HackerWorkspace";
import { ModeratorDashboard } from "./pages/moderator/ModeratorDashboard";
import { AnalystApplicationPage } from "./pages/analyst/AnalystApplicationPage";
import { ResearcherPortal } from "./pages/analyst/ResearcherPortal";
import { ReportScamPage } from "./pages/citizen/ReportScamPage";
import { TrackReportPage } from "./pages/citizen/TrackReportPage";
import { AdminPortal } from "./pages/admin/AdminPortal";

function NotFound() {
  return <main className="page-shell"><h1>Page not found</h1><Link to="/">Return home</Link></main>;
}

export default function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}

function AppShell() {
  const { language, direction } = useLanguage();
  const location = useLocation();
  return (
    <div className="app-frame" lang={language} dir={direction}><Navbar /><Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/analyst/apply" element={<RoleGate roles={["citizen"]}><CitizenLayout><AnalystApplicationPage /></CitizenLayout></RoleGate>} />
          <Route path="/researcher" element={<RoleGate roles={["citizen", "analyst", "mentor", "senior_reviewer"]}><ResearcherPortal /></RoleGate>} />
          <Route path="/citizen/report" element={<CitizenLayout><ReportScamPage /></CitizenLayout>} />
          <Route path="/citizen/track" element={<CitizenLayout><TrackReportPage /></CitizenLayout>} />
          <Route path="/moderator" element={<RoleGate roles={["moderator", "senior_reviewer", "platform_admin"]}><ModeratorLayout><ModeratorDashboard /></ModeratorLayout></RoleGate>} />
          <Route path="/admin" element={<RoleGate roles={["platform_admin"]}><AdminLayout><AdminPortal /></AdminLayout></RoleGate>} />
          <Route path="/hacker" element={<RoleGate roles={["analyst", "mentor", "senior_reviewer"]}><HackerLayout><HackerWorkspace /></HackerLayout></RoleGate>} />
          <Route path="*" element={<NotFound />} />
        </Routes>{location.pathname === "/" && <Footer />}</div>
  );
}
