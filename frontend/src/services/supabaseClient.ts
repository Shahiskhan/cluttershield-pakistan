import { createClient } from "@supabase/supabase-js";

const environmentUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const environmentPublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseUrl = environmentUrl ?? "";
export const publishableKey = environmentPublishableKey ?? "";
export const isSupabaseConfigured = Boolean(environmentUrl && environmentPublishableKey);

// Keep the SDK importable in an unconfigured checkout without embedding a real project.
const clientUrl = environmentUrl || "https://unconfigured.invalid";
const clientKey = environmentPublishableKey || "unconfigured";

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
