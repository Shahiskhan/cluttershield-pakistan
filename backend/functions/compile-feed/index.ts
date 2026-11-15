import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticate, hasRole } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, readJson, RequestInputError, requestId } from "../_shared/http.ts";

const MAX_ITEMS = 50_000;
const MAX_FEED_BYTES = 8 * 1024 * 1024;
const FEED_TTL_MS = 6 * 60 * 60_000;
type SourceItem = {
  indicator_id: string;
  type: "domain" | "url" | "phone";
  scope: "exact" | "host" | "path";
  ciphertext: string;
  risk_category: string;
  confidence_band: "low" | "medium" | "high";
  last_reviewed_at: string;
};
type FeedItem = {
  type: "domain" | "url" | "phone";
  scope: "exact" | "host" | "path";
  match_value: string;
  risk_category: string;
  confidence_band: "low" | "medium" | "high";
  last_reviewed_at: string;
  advisory: string;
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const id = requestId();
  if (!isOriginAllowed(req)) return json(req, { error: { code: "origin_not_allowed" }, request_id: id }, 403);
  if (req.method !== "POST") return json(req, { error: { code: "method_not_allowed" }, request_id: id }, 405);
  const auth = await authenticate(req);
  if (!auth.user || !auth.client) return json(req, { error: { code: auth.error }, request_id: id }, auth.error === "server_configuration" ? 503 : 401);

  try {
    const input = await readJson(req, 1000);
    if (input.action !== "compile") return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
    if (!await hasRole(auth.client, "platform_admin")) return json(req, { error: { code: "role_required" }, request_id: id }, 403);

    const keyId = Deno.env.get("FEED_SIGNING_KEY_ID") ?? "";
    const privateKeyText = Deno.env.get("FEED_SIGNING_PRIVATE_KEY_PKCS8") ?? "";
    const encryptionKeyText = Deno.env.get("INDICATOR_ENCRYPTION_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || !privateKeyText || !encryptionKeyText || !serviceRoleKey || !supabaseUrl) {
      return json(req, { error: { code: "server_configuration" }, request_id: id }, 503);
    }
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });

    const validUntil = new Date(Date.now() + FEED_TTL_MS).toISOString();
    const { data: compilation, error: beginError } = await service.rpc("begin_feed_release", {
      _actor_id: auth.user.id,
      _key_id: keyId,
      _valid_until: validUntil,
      _correlation_id: id,
    });
    if (beginError || !isRecord(compilation) || !Array.isArray(compilation.items) || compilation.items.length > MAX_ITEMS) {
      const code = beginError?.message.includes("signing_key_unavailable") ? "signing_key_unavailable" :
        beginError?.message.includes("preparing") ? "release_in_progress" : "compile_unavailable";
      return json(req, { error: { code }, request_id: id }, 409);
    }

    const version = Number(compilation.feed_version);
    const releaseId = compilation.release_id;
    const generatedAt = compilation.generated_at;
    if (!Number.isSafeInteger(version) || version < 1 || typeof releaseId !== "string" || typeof generatedAt !== "string") {
      return json(req, { error: { code: "invalid_release_reservation" }, request_id: id }, 500);
    }

    const key = await crypto.subtle.importKey("raw", decodeKey(encryptionKeyText), { name: "AES-GCM" }, false, ["decrypt"]);
    const internalItems = compilation.items as SourceItem[];
    const itemRows: Array<FeedItem & { indicator_id: string }> = [];
    for (const source of internalItems) {
      if (!source || !["domain", "url", "phone"].includes(source.type) ||
        !["exact", "host", "path"].includes(source.scope) || typeof source.ciphertext !== "string" ||
        typeof source.indicator_id !== "string") throw new Error("invalid_feed_source");
      const secret = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeCiphertext(source.ciphertext).slice(0, 12) }, key, decodeCiphertext(source.ciphertext).slice(12)),
      )) as { canonical?: unknown };
      if (typeof secret.canonical !== "string" || secret.canonical.length > 2048) throw new Error("invalid_feed_source");
      const matchValue = normalizeFeedValue(source.type, secret.canonical);
      itemRows.push({
        indicator_id: source.indicator_id,
        type: source.type,
        scope: source.scope,
        match_value: matchValue,
        risk_category: source.risk_category,
        confidence_band: source.confidence_band,
        last_reviewed_at: source.last_reviewed_at,
        advisory: advisoryFor(source.risk_category),
      });
    }
    itemRows.sort((a, b) => {
      const left = [a.type, a.match_value, a.scope, a.indicator_id].join("\u0000");
      const right = [b.type, b.match_value, b.scope, b.indicator_id].join("\u0000");
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const items: FeedItem[] = itemRows.map(({ indicator_id: _privateId, ...item }) => item);
    const payload = {
      schema_version: 1,
      feed_version: version,
      generated_at: generatedAt,
      valid_until: validUntil,
      key_id: keyId,
      algorithm: "Ed25519",
      metadata: { item_count: items.length, matching_rules_version: 1, source: "verified_public_indicators" },
      items,
    };
    const payloadBytes = new TextEncoder().encode(canonicalize(payload));
    if (payloadBytes.byteLength > MAX_FEED_BYTES) throw new Error("feed_too_large");
    const digest = toHex(await crypto.subtle.digest("SHA-256", payloadBytes));
    const signingKey = await crypto.subtle.importKey("pkcs8", decodeKey(privateKeyText), { name: "Ed25519" }, false, ["sign"]);
    const signature = toBase64(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, signingKey, payloadBytes)));
    if (typeof compilation.public_key !== "string") throw new Error("invalid_signing_key");
    const verificationKey = await crypto.subtle.importKey("raw", decodeKey(compilation.public_key), { name: "Ed25519" }, false, ["verify"]);
    const verified = await crypto.subtle.verify({ name: "Ed25519" }, verificationKey, decodeKey(signature), payloadBytes);
    if (!verified) throw new Error("signing_key_mismatch");
    const snapshot = { ...payload, payload_sha256: digest, signature };

    const { data: published, error: finishError } = await service.rpc("finish_feed_release", {
      _actor_id: auth.user.id,
      _release_id: releaseId,
      _snapshot: snapshot,
      _payload_sha256: digest,
      _signature: signature,
      _item_rows: itemRows,
    });
    if (finishError) return json(req, { error: { code: "publish_failed" }, request_id: id }, 409);
    return json(req, { data: published, request_id: id }, 201);
  } catch (error) {
    const code = error instanceof RequestInputError ? error.code :
      error instanceof Error && ["invalid_feed_source", "server_configuration", "invalid_signing_key", "signing_key_mismatch", "feed_too_large"].includes(error.message) ? error.message : "internal_error";
    if (code === "internal_error") console.error("compile-feed failed", id);
    return json(req, { error: { code }, request_id: id }, code === "internal_error" ? 500 : 400);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function decodeKey(value: string): Uint8Array {
  try { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
  catch { throw new Error("server_configuration"); }
}
function decodeCiphertext(value: string): Uint8Array {
  const bytes = decodeKey(value);
  if (bytes.length < 29) throw new Error("invalid_feed_source");
  return bytes;
}
function toHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_feed_source");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isRecord(value)) throw new Error("invalid_feed_source");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}
function normalizeFeedValue(type: SourceItem["type"], value: string): string {
  if (type === "phone") {
    const normalized = value.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error("invalid_feed_source");
    return normalized;
  }
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.includes(":")) throw new Error("invalid_feed_source");
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (type === "domain") return url.hostname;
  url.hash = "";
  url.search = "";
  return `${url.origin}${url.pathname}`;
}
function advisoryFor(category: string): string {
  const notices: Record<string, string> = {
    phishing_impersonation: "Potential phishing or impersonation risk. Verify the sender independently.",
    payment_fraud: "Potential payment fraud risk. Confirm requests through the official provider.",
    account_takeover: "Potential account security risk. Do not share verification codes or credentials.",
    delivery_fraud: "Potential delivery scam risk. Check tracking through the courier's official channel.",
    investment_job_scam: "Potential investment or job scam risk. Independently verify the organization.",
    other: "This indicator was reviewed as a potential online fraud risk.",
  };
  return notices[category] ?? notices.other;
}
