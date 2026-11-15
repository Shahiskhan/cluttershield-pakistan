import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticate, hasRole } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, readJson, RequestInputError, requestId } from "../_shared/http.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decisions = new Set(["triage", "needs_information", "rejected", "unverified_lead", "under_review", "closed"]);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const id = requestId();
  if (!isOriginAllowed(req)) return json(req, { error: { code: "origin_not_allowed" }, request_id: id }, 403);
  if (req.method !== "POST") return json(req, { error: { code: "method_not_allowed" }, request_id: id }, 405);
  const auth = await authenticate(req);
  if (!auth.user || !auth.client) return json(req, { error: { code: auth.error }, request_id: id }, auth.error === "server_configuration" ? 503 : 401);
  const isAdmin = await hasRole(auth.client, "platform_admin");
  const isModerator = await hasRole(auth.client, "moderator");
  if (!isAdmin && !isModerator) return json(req, { error: { code: "role_required" }, request_id: id }, 403);

  try {
    const input = await readJson(req, 4000);
    if (input.action === "queue") {
      const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(Number(input.limit), 50)) : 25;
      const { data, error } = isAdmin
        ? await auth.client.rpc("platform_admin_report_queue", { _limit: limit })
        : await auth.client.rpc("moderation_queue", { _limit: limit });
      if (error) return json(req, { error: { code: "request_failed" }, request_id: id }, 403);
      return json(req, { data, request_id: id });
    }
    if (input.action === "verify-indicator") {
      if (typeof input.reportId !== "string" || !UUID.test(input.reportId) ||
        typeof input.verificationSourceUrl !== "string" || !isPublicHttpUrl(input.verificationSourceUrl) ||
        typeof input.verificationNote !== "string" || input.verificationNote.trim().length < 10 ||
        input.verificationNote.length > 1000 || containsCitizenContact(input.verificationNote)) {
        return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
      }
      const { data, error } = await auth.client.rpc(isAdmin ? "admin_verify_indicator" : "moderator_verify_indicator", {
        _report_id: input.reportId,
        _verification_source_url: input.verificationSourceUrl,
        _verification_note: input.verificationNote.trim(),
        _correlation_id: id,
      });
      if (error) {
        const code = error.message.includes("scope_required") ? "scope_required" :
          error.message.includes("indicator_not_eligible") ? "indicator_not_eligible" :
          error.message.includes("invalid_transition") ? "invalid_transition" : "request_failed";
        return json(req, { error: { code }, request_id: id }, code === "scope_required" ? 403 : 409);
      }
      return json(req, { data, request_id: id }, 202);
    }
    if (input.action === "evidence-preview") {
      if (typeof input.reportId !== "string" || !UUID.test(input.reportId) ||
        typeof input.evidenceId !== "string" || !UUID.test(input.evidenceId)) {
        return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
      }
      const { data: objectKey, error } = await auth.client.rpc(isAdmin ? "admin_authorize_evidence_preview" : "authorize_moderator_evidence_preview", {
        _report_id: input.reportId,
        _evidence_id: input.evidenceId,
        _correlation_id: id,
      });
      if (error || typeof objectKey !== "string" || !/^objects\/[0-9a-f-]{36}$/i.test(objectKey)) {
        const code = error?.message.includes("evidence_pending_scan") ? "evidence_pending_scan" :
          error?.message.includes("scope_required") ? "scope_required" :
          error?.message.includes("not_found") ? "not_found" : "request_failed";
        const status = code === "scope_required" ? 403 : code === "not_found" ? 404 : code === "evidence_pending_scan" ? 409 : 400;
        return json(req, { error: { code }, request_id: id }, status);
      }
      const serviceUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceUrl || !serviceRoleKey) {
        return json(req, { error: { code: "server_configuration" }, request_id: id }, 503);
      }
      const service = createClient(serviceUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const { data: signed, error: signError } = await service.storage
        .from("evidence-private")
        .createSignedUrl(objectKey, 60);
      if (signError || !signed?.signedUrl) {
        console.error("moderator evidence signing failed", id);
        return json(req, { error: { code: "preview_unavailable" }, request_id: id }, 502);
      }
      return json(req, {
        data: { signed_url: signed.signedUrl, expires_at: new Date(Date.now() + 60_000).toISOString() },
        request_id: id,
      });
    }
    if (input.action !== "decision" || typeof input.reportId !== "string" || !UUID.test(input.reportId) ||
      typeof input.status !== "string" || !decisions.has(input.status) ||
      typeof input.reasonCode !== "string" || !/^[a-z0-9_]{2,64}$/i.test(input.reasonCode) ||
      (input.safeNote !== undefined && input.safeNote !== null &&
        (typeof input.safeNote !== "string" || input.safeNote.length > 500 || containsCitizenContact(input.safeNote)))) {
      return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
    }
    const { data, error } = await auth.client.rpc(isAdmin ? "admin_moderate_report" : "moderate_report", {
      _report_id: input.reportId,
      _to_status: input.status,
      _reason_code: input.reasonCode,
      _safe_note: input.safeNote ?? null,
      _correlation_id: id,
    });
    if (error) {
      const code = error.message === "scope_required" ? "scope_required" :
        error.message === "invalid_transition" ? "invalid_transition" : "request_failed";
      const status = code === "scope_required" ? 403 : code === "invalid_transition" ? 409 : 400;
      return json(req, { error: { code }, request_id: id }, status);
    }
    return json(req, { data, request_id: id });
  } catch (error) {
    const code = error instanceof RequestInputError ? error.code : "internal_error";
    if (code === "internal_error") console.error("moderator-review failed", id);
    return json(req, { error: { code }, request_id: id }, code === "internal_error" ? 500 : 400);
  }
});

function isPublicHttpUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
      !hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return false;
    return !containsCitizenContact(value);
  } catch {
    return false;
  }
}

function containsCitizenContact(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /(^|[^0-9])(?:\+?92[ -]?|0)?3[0-9]{2}[ -]?[0-9]{7}([^0-9]|$)/.test(value) ||
    /(^|[^0-9])[0-9]{5}-?[0-9]{7}-?[0-9]([^0-9]|$)/.test(value) ||
    /CS-[A-F0-9]{10}/i.test(value);
}

