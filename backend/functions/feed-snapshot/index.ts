import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";

const PUBLIC_CORS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
  "Vary": "Origin",
  "X-Content-Type-Options": "nosniff",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS });
  if (req.method !== "GET") return json(req, { error: { code: "method_not_allowed" } }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return json(req, { error: { code: "server_configuration" } }, 503);
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const { data, error } = await client.rpc("get_current_feed_snapshot");
  if (error) {
    console.error("feed snapshot lookup failed");
    return json(req, { error: { code: "feed_unavailable" } }, 503);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json(req, { error: { code: "no_active_release" } }, 503);
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...PUBLIC_CORS, "Content-Type": "application/json; charset=utf-8" },
  });
});
