import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import type { TranslationKey } from "../i18n/translations";

export function AuthPage() {
  const { user, roles, loading, signInWithPassword, signUpWithPassword, configured } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedDestination = (location.state as { from?: string } | null)?.from ?? searchParams.get("next");
  const homeForRole = roles.includes("platform_admin") ? "/admin"
    : roles.some((role) => ["moderator", "senior_reviewer"].includes(role)) ? "/moderator"
      : roles.some((role) => ["analyst", "mentor"].includes(role)) ? "/researcher"
        : "/citizen/report";
  const destination = isAllowedDestination(requestedDestination, roles) ? requestedDestination! : homeForRole;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">(searchParams.get("mode") === "signup" ? "signup" : "signin");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      if (mode === "signup") {
        const result = await signUpWithPassword(email, password);
        setSent(result.confirmationRequired);
      } else {
        await signInWithPassword(email, password);
      }
    } catch (cause) {
      setError(authMessage(cause, t));
    }
  };
  if (user && loading) return <main className="narrow-shell page-shell"><p className="muted">{t("authLoading")}</p></main>;
  if (user) return <Navigate to={destination} replace />;
  return (
    <main className="narrow-shell page-shell">
      <p className="eyebrow">{t("brand")}</p><h1>{mode === "signin" ? t("signIn") : t("createAccount")}</h1>
      <p className="muted">{t("authIntro")}</p>
      {!configured && <p className="notice notice-caution">{t("authConfig")}</p>}
      {sent ? <div className="notice notice-success" role="status">
        <p>{t("accountCreated")}</p>
        <button className="link-button" type="button" onClick={() => { setSent(false); setMode("signin"); }}>{t("backToSignIn")}</button>
      </div> : (
        <form className="form-card" onSubmit={submit}>
          <label>{t("emailAddress")}<input required type="email" dir="ltr" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{t("password")}<input required type="password" dir="ltr" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signup" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mode === "signup" && <p className="fine-print">{t("passwordHint")}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={!configured}>{mode === "signin" ? t("signIn") : t("createAccount")}</button>
          <button className="link-button mt-3" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setSent(false); }}>
            {mode === "signin" ? t("newAccountPrompt") : t("existingAccountPrompt")}
          </button>
        </form>
      )}
    </main>
  );
}

function isAllowedDestination(path: string | null | undefined, roles: string[]): boolean {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return false;
  if (path.startsWith("/admin")) return roles.includes("platform_admin");
  if (path.startsWith("/moderator")) return roles.some((role) => ["moderator", "senior_reviewer", "platform_admin"].includes(role));
  if (path.startsWith("/hacker")) return roles.some((role) => ["analyst", "mentor", "senior_reviewer"].includes(role));
  if (path.startsWith("/researcher") || path.startsWith("/analyst/apply")) return roles.some((role) => ["citizen", "analyst", "mentor", "senior_reviewer"].includes(role));
  if (path.startsWith("/citizen/")) return roles.includes("citizen");
  return path === "/";
}

function authMessage(cause: unknown, t: (key: TranslationKey) => string): string {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (message.includes("invalid login credentials")) return t("authInvalid");
  if (message.includes("email not confirmed")) return t("authEmailUnconfirmed");
  if (message.includes("user already registered")) return t("authAlreadyRegistered");
  if (message.includes("password should be at least")) return t("authWeakPassword");
  if (message.includes("rate limit")) return t("authRateLimit");
  if (message.includes("failed to fetch") || message.includes("network")) return t("authNetwork");
  return t("authGenericError");
}
