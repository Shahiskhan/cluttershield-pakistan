import { authenticate, hasRole } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, readJson, RequestInputError, requestId } from "../_shared/http.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLLABORATOR_ROLES = ["analyst", "moderator", "mentor", "senior_reviewer", "platform_admin"];

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
    const input = await readJson(req, 5000);
    let collaborator = false;
    for (const role of COLLABORATOR_ROLES) {
      if (await hasRole(auth.client, role)) {
        collaborator = true;
        break;
      }
    }
    if (!collaborator) return json(req, { error: { code: "role_required" }, request_id: id }, 403);

    if (input.action === "rooms") {
      const { data, error } = await auth.client.rpc("team_rooms_for_user");
      if (error) return json(req, { error: { code: "request_failed" }, request_id: id }, 403);
      return json(req, { data, request_id: id });
    }
    if (input.action !== "send" || typeof input.teamId !== "string" || !UUID.test(input.teamId) ||
      typeof input.body !== "string" || input.body.trim().length < 1 || input.body.length > 2000 ||
      containsCitizenContact(input.body)) {
      return json(req, { error: { code: "invalid_message" }, request_id: id }, 400);
    }

    const { data, error } = await auth.client.rpc("post_team_message", {
      _team_id: input.teamId,
      _body: input.body.trim(),
      _correlation_id: id,
    });
    if (error) {
      const code = error.message.includes("team_scope_required") ? "team_scope_required" :
        error.message.includes("rate_limited") ? "rate_limited" :
        error.message.includes("message_invalid_or_contains_personal_data") ? "invalid_message" : "request_failed";
      const status = code === "team_scope_required" ? 403 : code === "rate_limited" ? 429 : 400;
      return json(req, { error: { code }, request_id: id }, status);
    }
    return json(req, { data, request_id: id }, 201);
  } catch (error) {
    const code = error instanceof RequestInputError ? error.code : "internal_error";
    if (code === "internal_error") console.error("team-chat failed", id);
    return json(req, { error: { code }, request_id: id }, code === "internal_error" ? 500 : 400);
  }
});

function containsCitizenContact(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /(^|[^0-9])(?:\+?92[ -]?|0)?3[0-9]{2}[ -]?[0-9]{7}([^0-9]|$)/.test(value) ||
    /(^|[^0-9])[0-9]{5}-?[0-9]{7}-?[0-9]([^0-9]|$)/.test(value) ||
    /CS-[A-F0-9]{10}/i.test(value);
}
