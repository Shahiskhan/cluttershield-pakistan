import { authenticate } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, readJson, RequestInputError, requestId } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const id = requestId();
  if (!isOriginAllowed(req)) return json(req, { error: { code: "origin_not_allowed" }, request_id: id }, 403);
  if (req.method !== "POST") return json(req, { error: { code: "method_not_allowed" }, request_id: id }, 405);
  const auth = await authenticate(req);
  if (!auth.user || !auth.client) return json(req, { error: { code: auth.error }, request_id: id }, auth.error === "server_configuration" ? 503 : 401);
  try {
    const input = await readJson(req, 2000);
    if (typeof input.reportRef !== "string" || !/^CS-[A-F0-9]{10}$/i.test(input.reportRef)) {
      return json(req, { error: { code: "not_found" }, request_id: id }, 404);
    }
    const { data, error } = await auth.client.rpc("get_own_report", { _report_ref: input.reportRef.toUpperCase() });
    if (error || !data) return json(req, { error: { code: "not_found" }, request_id: id }, 404);
    return json(req, { data, request_id: id });
  } catch (error) {
    const code = error instanceof RequestInputError ? error.code : "internal_error";
    if (code === "internal_error") console.error("get-own-report failed", id);
    return json(req, { error: { code }, request_id: id }, code === "internal_error" ? 500 : 400);
  }
});

