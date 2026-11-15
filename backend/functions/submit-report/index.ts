import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticate } from "../_shared/auth.ts";
import { protectIndicator } from "../_shared/crypto.ts";
import { isOriginAllowed, json, preflight, readJson, RequestInputError, requestId } from "../_shared/http.ts";
import { normalizeIndicator } from "../_shared/indicator.ts";

const categories = new Set(["phishing_url", "payment_fraud", "impersonation", "account_takeover", "marketplace_fraud", "investment_job_scam", "delivery_fraud", "other"]);
const channels = new Set(["sms", "whatsapp", "social_media", "phone_call", "email", "website", "website_social_media", "marketplace", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const id = requestId();
  if (!isOriginAllowed(req)) return json(req, { error: { code: "origin_not_allowed" }, request_id: id }, 403);
  if (req.method !== "POST") return json(req, { error: { code: "method_not_allowed" }, request_id: id }, 405);
  let reporterUserId: string | null = null;
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  const configuredPublicKeys = [Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), Deno.env.get("SUPABASE_ANON_KEY")].filter(Boolean);
  if (bearer && bearer.startsWith("eyJ") && !configuredPublicKeys.includes(bearer)) {
    const auth = await authenticate(req);
    if (!auth.user || !auth.client) return json(req, { error: { code: auth.error }, request_id: id }, auth.error === "server_configuration" ? 503 : 401);
    const { data: roles, error: roleError } = await auth.client.rpc("get_my_roles");
    if (roleError || !Array.isArray(roles) || !roles.includes("citizen")) {
      return json(req, { error: { code: "role_required" }, request_id: id }, 403);
    }
    reporterUserId = auth.user.id;
  }
  const serviceUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceUrl || !serviceRoleKey) return json(req, { error: { code: "server_configuration" }, request_id: id }, 503);
  const service = createClient(serviceUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });

  try {
    const input = await readJson(req);
    const category = input.category;
    const channel = input.channel;
    const narrative = input.narrative;
    const incidentTimezone = input.incidentTimezone;
    const incidentAt = input.incidentAt;
    const submissionKey = input.submissionKey;
    const consent = input.consent;
    const indicator = input.indicator;
    if (typeof category !== "string" || !categories.has(category) || typeof channel !== "string" || !channels.has(channel) ||
      typeof narrative !== "string" || narrative.trim().length < 10 || narrative.length > 5000 ||
      typeof submissionKey !== "string" || !UUID.test(submissionKey) ||
      consent === null || typeof consent !== "object" || Array.isArray(consent) ||
      (consent as Record<string, unknown>).accepted !== true ||
      (consent as Record<string, unknown>).noticeVersion !== "citizen-notice-1.0") {
      return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
    }
    if (incidentTimezone !== undefined && incidentTimezone !== null &&
      (typeof incidentTimezone !== "string" || incidentTimezone.length > 64)) {
      return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
    }
    let incidentTimestamp: string | null = null;
    if (incidentAt !== undefined && incidentAt !== null && incidentAt !== "") {
      if (typeof incidentAt !== "string" || !Number.isFinite(Date.parse(incidentAt))) {
        return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
      }
      incidentTimestamp = new Date(incidentAt).toISOString();
    }
    if (indicator === null || typeof indicator !== "object" || Array.isArray(indicator)) {
      return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
    }
    const candidate = normalizeIndicator((indicator as Record<string, unknown>).type, (indicator as Record<string, unknown>).value);
    const protectedValue = await protectIndicator(candidate.original, candidate.canonical);
    let requesterHash: string | null = null;
    if (!reporterUserId) {
      const hmacSecret = decodeKey(Deno.env.get("ANONYMOUS_REPORT_HMAC_KEY") ?? "");
      const address = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      if (!address || address.length > 128) return json(req, { error: { code: "anonymous_intake_unavailable" }, request_id: id }, 503);
      const hmacKey = await crypto.subtle.importKey("raw", hmacSecret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const hash = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(address));
      requesterHash = `\\x${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
    const { data, error } = await service.rpc("submit_citizen_report", {
      _reporter_user_id: reporterUserId,
      _requester_hash: requesterHash,
      _submission_key: submissionKey,
      _category: category,
      _channel: channel,
      _incident_at: incidentTimestamp,
      _incident_timezone: typeof incidentTimezone === "string" ? incidentTimezone : null,
      _narrative: narrative.trim(),
      _indicator_type: candidate.type,
      _indicator_ciphertext: protectedValue.ciphertextBytea,
      _indicator_hash: protectedValue.hashBytea,
      _hash_key_version: protectedValue.keyVersion,
      _indicator_masked: candidate.masked,
      _notice_version: (consent as Record<string, unknown>).noticeVersion,
      _correlation_id: id,
    });
    if (error) {
      const code = error.message.includes("rate_limited") ? "rate_limited" :
        error.message === "authentication_required" ? "authentication_required" :
        error.message === "role_required" ? "role_required" : "invalid_request";
      const status = code === "rate_limited" ? 429 : code === "role_required" ? 403 : code === "authentication_required" ? 401 : 400;
      return json(req, { error: { code }, request_id: id }, status);
    }
    return json(req, { data, request_id: id }, 201);
  } catch (error) {
    if (error instanceof RequestInputError) return json(req, { error: { code: error.code }, request_id: id }, 400);
    const code = error instanceof Error && error.message === "unsupported_indicator_type" ? "unsupported_indicator_type" :
      error instanceof Error && error.message === "invalid_indicator" ? "invalid_indicator" :
      error instanceof Error && error.message === "server_configuration" ? "server_configuration" : "internal_error";
    const status = code === "server_configuration" ? 503 : code === "internal_error" ? 500 : 400;
    if (status === 500) console.error("submit-report failed", id);
    return json(req, { error: { code }, request_id: id }, status);
  }
});

function decodeKey(value: string): Uint8Array {
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.length !== 32) throw new Error();
    return bytes;
  } catch {
    throw new Error("server_configuration");
  }
}

