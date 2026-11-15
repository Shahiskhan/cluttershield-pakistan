import { isOriginAllowed, json, preflight, requestId } from "./http.ts";

export function notImplemented(name: string, status = 501) {
  return (req: Request) => {
    const pre = preflight(req);
    if (pre) return pre;
    const id = requestId();
    if (!isOriginAllowed(req)) return json(req, { error: { code: "origin_not_allowed" }, request_id: id }, 403);
    if (req.method !== "POST" && req.method !== "GET") {
      return json(req, { error: { code: "method_not_allowed" }, request_id: id }, 405);
    }
    return json(req, {
      error: { code: status === 503 ? "feed_not_configured" : "workflow_not_configured" },
      request_id: id,
      module: name,
    }, status);
  };
}

