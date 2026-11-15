const DEFAULT_LOCAL_ORIGIN = "http://localhost:5173";

export function requestId(): string {
  return crypto.randomUUID();
}

function allowedOrigins(): Set<string> {
  return new Set(
    (Deno.env.get("ALLOWED_ORIGINS") ?? `${DEFAULT_LOCAL_ORIGIN},http://127.0.0.1:5173`)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || allowedOrigins().has(origin);
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-evidence-ticket",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  if (!isOriginAllowed(req)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function readJson(req: Request, maxBytes = 24_000): Promise<Record<string, unknown>> {
  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (declaredSize > maxBytes) throw new RequestInputError("payload_too_large");
  const reader = req.body?.getReader();
  if (!reader) throw new RequestInputError("invalid_request");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RequestInputError("payload_too_large");
    }
    chunks.push(value);
  }
  if (totalBytes === 0) throw new RequestInputError("invalid_request");
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestInputError("invalid_request");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestInputError("invalid_request");
  }
  return parsed as Record<string, unknown>;
}

export async function readBytes(req: Request, maxBytes: number, expectedBytes?: number): Promise<Uint8Array> {
  const declaredSizeHeader = req.headers.get("content-length");
  const declaredSize = declaredSizeHeader === null ? null : Number(declaredSizeHeader);
  if (declaredSize !== null && (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > maxBytes)) {
    throw new RequestInputError("payload_too_large");
  }
  if (expectedBytes !== undefined && declaredSize !== null && declaredSize !== expectedBytes) {
    throw new RequestInputError("invalid_request");
  }
  const reader = req.body?.getReader();
  if (!reader) throw new RequestInputError("invalid_request");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes || (expectedBytes !== undefined && totalBytes > expectedBytes)) {
      await reader.cancel();
      throw new RequestInputError("payload_too_large");
    }
    chunks.push(value);
  }
  if (totalBytes === 0 || (expectedBytes !== undefined && totalBytes !== expectedBytes)) {
    throw new RequestInputError("invalid_request");
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class RequestInputError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function methodNotAllowed(req: Request, methods: string[]): Response {
  return json(req, { error: { code: "method_not_allowed" } }, 405);
}

