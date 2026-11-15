import { authenticate, hasRole } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, readJson, RequestInputError, requestId } from "../_shared/http.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const id = requestId();
  if (!isOriginAllowed(req)) return json(req, { error: { code: "origin_not_allowed" }, request_id: id }, 403);
  if (req.method !== "POST") return json(req, { error: { code: "method_not_allowed" }, request_id: id }, 405);
  const auth = await authenticate(req);
  if (!auth.user || !auth.client) {
    return json(req, { error: { code: auth.error }, request_id: id }, auth.error === "server_configuration" ? 503 : 401);
  }

  try {
    const input = await readJson(req, 6000);
    const allowedReviewer = await hasRole(auth.client, "senior_reviewer") || await hasRole(auth.client, "platform_admin");
    if (!allowedReviewer) return json(req, { error: { code: "role_required" }, request_id: id }, 403);

    if (input.action === "list") {
      const { data, error } = await auth.client.rpc("indicator_publication_queue");
      if (error) return json(req, { error: { code: "request_failed" }, request_id: id }, 403);
      return json(req, { data, request_id: id });
    }

    if (input.action !== "decision" ||
      typeof input.indicatorId !== "string" || !UUID.test(input.indicatorId) ||
      (input.decision !== "approved" && input.decision !== "rejected") ||
      typeof input.verificationSourceUrl !== "string" || !isPublicHttpUrl(input.verificationSourceUrl) ||
      typeof input.verificationNote !== "string" || input.verificationNote.trim().length < 10 ||
      input.verificationNote.length > 1000 || containsCitizenContact(input.verificationNote) ||
      (input.decision === "approved" && (!Number.isInteger(input.confidence) || Number(input.confidence) < 50 || Number(input.confidence) > 90))) {
      return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
    }

    const { data, error } = await auth.client.rpc("review_indicator_publication", {
      _indicator_id: input.indicatorId,
      _decision: input.decision,
      _confidence: input.decision === "approved" ? Number(input.confidence) : null,
      _verification_source_url: input.verificationSourceUrl,
      _verification_note: input.verificationNote.trim(),
      _correlation_id: id,
    });
    if (error) {
      const code = error.message.includes("independent_review_required") ? "independent_review_required" :
        error.message.includes("already_reviewed") ? "already_reviewed" :
        error.message.includes("first_review_required") ? "first_review_required" :
        error.message.includes("not_available") ? "not_available" : "request_failed";
      const status = code === "independent_review_required" ? 403 :
        code === "not_available" ? 404 : code === "already_reviewed" ? 409 : 400;
      return json(req, { error: { code }, request_id: id }, status);
    }
    return json(req, { data, request_id: id });
  } catch (error) {
    const code = error instanceof RequestInputError ? error.code : "internal_error";
    if (code === "internal_error") console.error("approve-indicator failed", id);
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
