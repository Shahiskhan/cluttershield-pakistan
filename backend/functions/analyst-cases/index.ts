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
  if (!auth.user || !auth.client) return json(req, { error: { code: auth.error }, request_id: id }, auth.error === "server_configuration" ? 503 : 401);
  try {
    const input = await readJson(req, 4000);
    if (input.action === "list") {
      if (!await hasRole(auth.client, "analyst")) return json(req, { error: { code: "role_required" }, request_id: id }, 403);
      const { data, error } = await auth.client.rpc("analyst_case_summaries");
      if (error) return json(req, { error: { code: "request_failed" }, request_id: id }, 403);
      return json(req, { data, request_id: id });
    }
    if (input.action === "mentor-queue") {
      const canReview = await hasRole(auth.client, "mentor") || await hasRole(auth.client, "senior_reviewer");
      if (!canReview) return json(req, { error: { code: "role_required" }, request_id: id }, 403);
      const { data, error } = await auth.client.rpc("mentor_finding_queue");
      if (error) return json(req, { error: { code: "request_failed" }, request_id: id }, 403);
      return json(req, { data, request_id: id });
    }
    if (!await hasRole(auth.client, "analyst")) return json(req, { error: { code: "role_required" }, request_id: id }, 403);
    if (input.action !== "claim" || typeof input.caseId !== "string" || !UUID.test(input.caseId) || input.conflictsReviewed !== true) {
      return json(req, { error: { code: "invalid_request" }, request_id: id }, 400);
    }
    const { data, error } = await auth.client.rpc("request_case_claim", {
      _case_id: input.caseId,
      _conflict_check: { conflicts_reviewed: true },
      _correlation_id: id,
    });
    if (error) {
      const code = error.message.includes("analyst_capacity_reached") ? "analyst_capacity_reached" :
        error.message.includes("capacity_reached") ? "capacity_reached" :
        error.message.includes("not_available") ? "not_available" : "request_failed";
      const status = code === "not_available" ? 404 : code.includes("capacity") ? 409 : 400;
      return json(req, { error: { code }, request_id: id }, status);
    }
    return json(req, { data, request_id: id }, 202);
  } catch (error) {
    const code = error instanceof RequestInputError ? error.code : "internal_error";
    if (code === "internal_error") console.error("analyst-cases failed", id);
    return json(req, { error: { code }, request_id: id }, code === "internal_error" ? 500 : 400);
  }
});

