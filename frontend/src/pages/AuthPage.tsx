import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function AuthPage() {
  const { user, roles, loading, signInWithPassword, signUpWithPassword, configured } = useAuth();
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
      setError(authMessage(cause));
    }
  };
  if (user && loading) return <main className="narrow-shell page-shell"><p className="muted">Loading your secure workspace…</p></main>;
  if (user) return <Navigate to={destination} replace />;
  return (
    <main className="narrow-shell page-shell">
      <p className="eyebrow">Secure access</p><h1>{mode === "signin" ? "Sign in" : "Create your account"}</h1>
      <p className="muted">Citizen accounts can submit reports and apply to join the research team. Elevated roles are granted only after staff review.</p>
      {!configured && <p className="notice notice-caution">Add the local Supabase URL and publishable key in <code>.env.local</code> to enable sign-in.</p>}
      {sent ? <div className="notice notice-success" role="status">
        <p>Account created. Check your email for the confirmation link, then sign in here. Your account will have citizen access until an administrator approves any researcher application.</p>
        <button className="link-button" type="button" onClick={() => { setSent(false); setMode("signin"); }}>Back to sign in</button>
      </div> : (
        <form className="form-card" onSubmit={submit}>
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input required type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signup" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mode === "signup" && <p className="fine-print">Use at least 12 characters. Signup creates a citizen account; it does not grant moderator or analyst access.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={!configured}>{mode === "signin" ? "Sign in" : "Create account"}</button>
          <button className="link-button mt-3" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setSent(false); }}>
            {mode === "signin" ? "New here? Create a citizen account" : "Already registered? Sign in"}
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

function authMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (message.includes("invalid login credentials")) return "Email or password is incorrect. If you just registered, confirm your email first.";
  if (message.includes("email not confirmed")) return "Confirm your email from the message Supabase sent, then sign in.";
  if (message.includes("user already registered")) return "An account already uses this email. Switch to sign in.";
  if (message.includes("password should be at least")) return "Choose a longer password and try again.";
  if (message.includes("rate limit")) return "Too many attempts. Wait a few minutes and try again.";
  if (message.includes("failed to fetch") || message.includes("network")) return "Could not reach Supabase. Check your connection and project configuration.";
  return "Authentication could not be completed. Check the form and your Supabase Auth email/password settings.";
}
