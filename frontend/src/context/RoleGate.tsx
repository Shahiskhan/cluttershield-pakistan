import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { AppRole } from "../types";
import { useAuth } from "./AuthContext";

export function RoleGate({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { user, loading, roles: activeRoles } = useAuth();
  const location = useLocation();
  if (loading) return <main className="page-shell"><p className="muted">Loading your secure session…</p></main>;
  if (!user) return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  if (!roles.some((role) => activeRoles.includes(role))) {
    return <main className="page-shell"><h1>Access is not assigned</h1><p className="muted">Your current account does not have an active role for this workspace.</p></main>;
  }
  return <>{children}</>;
}
