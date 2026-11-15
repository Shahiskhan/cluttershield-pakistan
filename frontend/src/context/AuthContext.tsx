import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole } from "../types";
import { isSupabaseConfigured, supabase } from "../services/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  configured: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<{ confirmationRequired: boolean }>;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const latestUserId = useRef<string | null>(null);

  const refreshRoles = useCallback(async () => {
    if (!session?.user) {
      setRoles([]);
      return;
    }
    const userId = session.user.id;
    const { data, error } = await supabase.rpc("get_my_roles");
    if (latestUserId.current === userId) setRoles(!error && Array.isArray(data) ? data as AppRole[] : []);
  }, [session?.user?.id]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        latestUserId.current = data.session?.user.id ?? null;
        setSession(data.session);
        if (!data.session) setLoading(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      if (latestUserId.current !== nextUserId) {
        setRoles([]);
        setLoading(nextUserId !== null);
      }
      latestUserId.current = nextUserId;
      setSession(nextSession);
      if (!nextSession) setLoading(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!session?.user) {
      setRoles([]);
      setLoading(false);
      return () => { active = false; };
    }
    const userId = session.user.id;
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("get_my_roles");
        if (active && latestUserId.current === userId) {
          setRoles(!error && Array.isArray(data) ? data as AppRole[] : []);
          setLoading(false);
        }
      } catch {
        if (active && latestUserId.current === userId) {
          setRoles([]);
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [session?.user?.id]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    roles,
    loading,
    configured: isSupabaseConfigured,
    signInWithPassword: async (email, password) => {
      if (!isSupabaseConfigured) throw new Error("Set the Supabase frontend environment variables first.");
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
    },
    signUpWithPassword: async (email, password) => {
      if (!isSupabaseConfigured) throw new Error("Set the Supabase frontend environment variables first.");
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;
      return { confirmationRequired: !data.session };
    },
    signOut: async () => { await supabase.auth.signOut(); },
    refreshRoles,
  }), [session, roles, loading, refreshRoles]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
