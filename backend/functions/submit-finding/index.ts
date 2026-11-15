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
    const input = await readJson(req, 30_000);
    if (input.action === "review") {
      const reviewer = await hasRole(auth.client, "mentor") || await hasRole(auth.client, "senior_reviewer");
      if (!reviewer) return json(req, { error: { code: "role_required" }, request_id: id }, 403);
      if (typeof input.findingId !== "string" || !UUID.test(input.findingId) ||
        (input.decision !== "accepted" && input.decision !== "changes_requested") ||
        typeof input.feedback !== "string" || input.feedback.trim().length < 10 ||
        input.feedback.length > 1000 || containsCitizenContact(input.feedback)) {
        return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
      }
      const { data, error } = await auth.client.rpc("review_osint_finding", {
        _finding_id: input.findingId,
        _decision: input.decision,
        _feedback: input.feedback.trim(),
        _correlation_id: id,
      });
      if (error) {
        const code = error.message.includes("independent_review_required") ? "independent_review_required" :
          error.message.includes("not_available") ? "not_available" : "request_failed";
        return json(req, { error: { code }, request_id: id }, code === "not_available" ? 404 : 403);
      }
      return json(req, { data, request_id: id });
    }

    if (!await hasRole(auth.client, "analyst")) {
      return json(req, { error: { code: "role_required" }, request_id: id }, 403);
    }
    if (input.action !== "submit" ||
      typeof input.assignmentId !== "string" || !UUID.test(input.assignmentId) ||
      typeof input.summary !== "string" || input.summary.trim().length < 10 || input.summary.length > 2000 ||
      typeof input.limitations !== "string" || input.limitations.trim().length < 10 || input.limitations.length > 1000 ||
      containsCitizenContact(input.summary) || containsCitizenContact(input.limitations) ||
      typeof input.confidence !== "number" || !Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100 ||
      !Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 10) {
      return json(req, { error: { code: "invalid_finding" }, request_id: id }, 400);
    }
    const sources: Array<{ url: string; observed_at: string }> = [];
    for (const source of input.sources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        return json(req, { error: { code: "invalid_finding" }, request_id: id }, 400);
      }
      const item = source as Record<string, unknown>;
      if (typeof item.url !== "string" || !isPublicHttpUrl(item.url) ||
        typeof item.observedAt !== "string" || !Number.isFinite(Date.parse(item.observedAt)) ||
        Date.parse(item.observedAt) > Date.now() + 5 * 60_000) {
        return json(req, { error: { code: "invalid_finding" }, request_id: id }, 400);
      }
      sources.push({ url: item.url, observed_at: new Date(item.observedAt).toISOString() });
    }

    const { data, error } = await auth.client.rpc("submit_osint_finding", {
      _assignment_id: input.assignmentId,
      _summary: input.summary.trim(),
      _sources: sources,
      _confidence: input.confidence,
      _limitations: input.limitations.trim(),
      _correlation_id: id,
    });
    if (error) {
      const code = error.message.includes("assignment_scope_required") ? "assignment_scope_required" :
        error.message.includes("finding_already_submitted") ? "finding_already_submitted" :
        error.message.includes("invalid_finding") ? "invalid_finding" : "request_failed";
      return json(req, { error: { code }, request_id: id }, code === "assignment_scope_required" ? 403 : 400);
    }
    return json(req, { data, request_id: id }, 201);
  } catch (error) {
    const code = error instanceof RequestInputError ? error.code : "internal_error";
    if (code === "internal_error") console.error("submit-finding failed", id);
    return json(req, { error: { code }, request_id: id }, code === "internal_error" ? 500 : 400);
  }
});

function isPublicHttpUrl(value: string): boolean {
  if (value.length > 2048 || containsCitizenContact(value)) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
      !hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return false;
    return true;
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
