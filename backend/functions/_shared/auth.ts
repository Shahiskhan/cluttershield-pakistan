import { createClient } from "jsr:@supabase/supabase-js@2";

export async function authenticate(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return { user: null, client: null, error: "authentication_required" as const };

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !publishableKey) return { user: null, client: null, error: "server_configuration" as const };

  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
  });
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) return { user: null, client: null, error: "authentication_required" as const };
  return { user: data.user, client, error: null };
}

export async function hasRole(client: NonNullable<Awaited<ReturnType<typeof authenticate>>["client"]>, role: string) {
  const { data, error } = await client.rpc("get_my_roles");
  if (error || !Array.isArray(data)) return false;
  return data.includes(role);
}

