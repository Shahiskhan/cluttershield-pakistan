import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticate } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, readBytes, readJson, RequestInputError, requestId } from "../_shared/http.ts";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_KEY = /^objects\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UploadTicketPayload {
  v: 1;
  evidenceId: string;
  objectKey: string;
  userId: string | null;
  reportRef: string;
  contentType: string;
  byteSize: number;
  expiresAt: string;
  jti: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const id = requestId();
  if (!isOriginAllowed(req)) return json(req, { error: { code: "origin_not_allowed" }, request_id: id }, 403);
  if (req.method !== "POST" && req.method !== "PUT") {
    return json(req, { error: { code: "method_not_allowed" }, request_id: id }, 405);
  }
  const auth = await authenticate(req);
  if (auth.error === "server_configuration") {
    return json(req, { error: { code: auth.error }, request_id: id }, 503);
  }

  try {
    if (req.method === "POST") {
      if (auth.user && auth.client) return await authorizeUpload(req, auth.user.id, auth.client, id);
      return await authorizeAnonymousUpload(req, id);
    }
    const ticket = req.headers.get("x-evidence-ticket") ?? "";
    const payload = await verifyTicket(ticket);
    if (!payload) return json(req, { error: { code: "upload_not_authorized" }, request_id: id }, 403);
    if (payload.userId !== null && (!auth.user || !auth.client || auth.user.id !== payload.userId)) {
      return json(req, { error: { code: auth.user ? "upload_not_authorized" : "authentication_required" }, request_id: id }, auth.user ? 403 : 401);
    }
    return await receiveUpload(req, payload, payload.userId ? auth.client : null, id);
  } catch (error) {
    if (error instanceof RequestInputError) {
      const status = error.code === "payload_too_large" ? 413 : 400;
      return json(req, { error: { code: error.code }, request_id: id }, status);
    }
    if (error instanceof Error && error.message === "server_configuration") {
      return json(req, { error: { code: error.message }, request_id: id }, 503);
    }
    if (error instanceof Error && error.message === "anonymous_intake_unavailable") {
      return json(req, { error: { code: error.message }, request_id: id }, 503);
    }
    console.error("upload-evidence failed", id);
    return json(req, { error: { code: "internal_error" }, request_id: id }, 500);
  }
});

async function authorizeUpload(
  req: Request,
  userId: string,
  client: NonNullable<Awaited<ReturnType<typeof authenticate>>["client"]>,
  requestIdValue: string,
): Promise<Response> {
  const input = await readJson(req, 5000);
  if (input.action !== "authorize" ||
    typeof input.reportRef !== "string" || !/^CS-([A-F0-9]{10}|[A-F0-9]{32})$/i.test(input.reportRef) ||
    typeof input.fileName !== "string" || !isSafeFileName(input.fileName) ||
    typeof input.contentType !== "string" || !ALLOWED_TYPES.has(input.contentType) ||
    typeof input.size !== "number" || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_FILE_BYTES) {
    return json(req, { error: { code: "invalid_request" }, request_id: requestIdValue }, 400);
  }

  const { data, error } = await client.rpc("authorize_evidence_upload", {
    _report_ref: input.reportRef.toUpperCase(),
    _file_name: input.fileName,
    _content_type: input.contentType,
    _byte_size: input.size,
  });
  if (error || !data || typeof data !== "object") {
    const code = error?.message.includes("not_found") ? "not_found" :
      error?.message.includes("evidence_not_allowed") ? "evidence_not_allowed" :
      error?.message.includes("evidence_limit_reached") ? "evidence_limit_reached" :
      error?.message.includes("rate_limited") ? "rate_limited" :
      error?.message.includes("role_required") ? "role_required" : "invalid_request";
    const status = code === "not_found" ? 404 : code === "role_required" ? 403 :
      code === "evidence_limit_reached" || code === "rate_limited" ? 429 : 400;
    return json(req, { error: { code }, request_id: requestIdValue }, status);
  }

  const authorized = data as Record<string, unknown>;
  if (typeof authorized.evidence_id !== "string" || !UUID.test(authorized.evidence_id) ||
    typeof authorized.object_key !== "string" || !OBJECT_KEY.test(authorized.object_key) ||
    authorized.user_id !== userId || authorized.content_type !== input.contentType ||
    authorized.byte_size !== input.size || typeof authorized.expires_at !== "string") {
    return json(req, { error: { code: "invalid_response" }, request_id: requestIdValue }, 500);
  }

  const payload: UploadTicketPayload = {
    v: 1,
    evidenceId: authorized.evidence_id,
    objectKey: authorized.object_key,
    userId,
    reportRef: input.reportRef.toUpperCase(),
    contentType: input.contentType,
    byteSize: input.size,
    expiresAt: authorized.expires_at,
    jti: crypto.randomUUID(),
  };
  const uploadTicket = await signTicket(payload);
  return json(req, {
    data: {
      evidence_id: payload.evidenceId,
      upload_ticket: uploadTicket,
      expires_at: payload.expiresAt,
    },
    request_id: requestIdValue,
  }, 201);
}

async function authorizeAnonymousUpload(req: Request, requestIdValue: string): Promise<Response> {
  const input = await readJson(req, 5000);
  if (input.action !== "authorize" || typeof input.reportRef !== "string" || !/^CS-[A-F0-9]{32}$/i.test(input.reportRef) ||
    typeof input.fileName !== "string" || !isSafeFileName(input.fileName) ||
    typeof input.contentType !== "string" || !ALLOWED_TYPES.has(input.contentType) ||
    typeof input.size !== "number" || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_FILE_BYTES) {
    return json(req, { error: { code: "invalid_request" }, request_id: requestIdValue }, 400);
  }
  const requesterHash = await getRequesterHash(req);
  const service = createServiceClient();
  const { data, error } = await service.rpc("authorize_anonymous_evidence_upload", {
    _report_ref: input.reportRef.toUpperCase(),
    _requester_hash: requesterHash,
    _file_name: input.fileName,
    _content_type: input.contentType,
    _byte_size: input.size,
  });
  if (error || !data || typeof data !== "object") {
    const code = error?.message.includes("not_found") ? "not_found" :
      error?.message.includes("evidence_not_allowed") ? "evidence_not_allowed" :
      error?.message.includes("evidence_limit_reached") ? "evidence_limit_reached" :
      error?.message.includes("rate_limited") ? "rate_limited" : "invalid_request";
    const status = code === "not_found" ? 404 : code === "rate_limited" || code === "evidence_limit_reached" ? 429 : 400;
    return json(req, { error: { code }, request_id: requestIdValue }, status);
  }
  const authorized = data as Record<string, unknown>;
  if (typeof authorized.evidence_id !== "string" || !UUID.test(authorized.evidence_id) ||
    typeof authorized.object_key !== "string" || !OBJECT_KEY.test(authorized.object_key) ||
    authorized.user_id !== null || authorized.content_type !== input.contentType ||
    authorized.byte_size !== input.size || typeof authorized.expires_at !== "string") {
    return json(req, { error: { code: "invalid_response" }, request_id: requestIdValue }, 500);
  }
  const payload: UploadTicketPayload = {
    v: 1,
    evidenceId: authorized.evidence_id,
    objectKey: authorized.object_key,
    userId: null,
    reportRef: input.reportRef.toUpperCase(),
    contentType: input.contentType,
    byteSize: input.size,
    expiresAt: authorized.expires_at,
    jti: crypto.randomUUID(),
  };
  return json(req, { data: { evidence_id: payload.evidenceId, upload_ticket: await signTicket(payload), expires_at: payload.expiresAt }, request_id: requestIdValue }, 201);
}

async function receiveUpload(
  req: Request,
  payload: UploadTicketPayload,
  client: NonNullable<Awaited<ReturnType<typeof authenticate>>["client"]> | null,
  requestIdValue: string,
): Promise<Response> {
  if (Date.parse(payload.expiresAt) <= Date.now()) {
    return json(req, { error: { code: "upload_ticket_expired" }, request_id: requestIdValue }, 410);
  }
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType !== payload.contentType || !ALLOWED_TYPES.has(contentType)) {
    return json(req, { error: { code: "unsupported_evidence_type" }, request_id: requestIdValue }, 415);
  }

  const verifier = payload.userId === null ? createServiceClient() : client;
  if (!verifier) return json(req, { error: { code: "authentication_required" }, request_id: requestIdValue }, 401);
  const { data: validTicket, error: ticketError } = payload.userId === null
    ? await verifier.rpc("verify_anonymous_evidence_upload_ticket", {
      _evidence_id: payload.evidenceId,
      _object_key: payload.objectKey,
      _content_type: payload.contentType,
      _byte_size: payload.byteSize,
      _expires_at: payload.expiresAt,
      _report_ref: payload.reportRef,
    })
    : await verifier.rpc("verify_evidence_upload_ticket", {
      _evidence_id: payload.evidenceId,
      _object_key: payload.objectKey,
      _content_type: payload.contentType,
      _byte_size: payload.byteSize,
      _expires_at: payload.expiresAt,
    });
  if (ticketError || validTicket !== true) {
    return json(req, { error: { code: "upload_not_authorized" }, request_id: requestIdValue }, 403);
  }

  const bytes = await readBytes(req, MAX_FILE_BYTES, payload.byteSize);
  const observedType = sniffContentType(bytes);
  if (observedType !== payload.contentType) {
    return json(req, { error: { code: "unsupported_evidence_type" }, request_id: requestIdValue }, 415);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const service = createServiceClient();
  const { error: uploadError } = await service.storage
    .from("evidence-private")
    .upload(payload.objectKey, bytes, {
      cacheControl: "0",
      contentType: observedType,
      upsert: false,
    });
  if (uploadError) {
    const code = uploadError.message.toLowerCase().includes("already exists") ? "upload_already_used" : "evidence_upload_failed";
    const status = code === "upload_already_used" ? 409 : 502;
    return json(req, { error: { code }, request_id: requestIdValue }, status);
  }

  const { error: completionError } = await service.rpc("complete_evidence_upload", {
    _evidence_id: payload.evidenceId,
    _object_key: payload.objectKey,
    _actual_size: bytes.byteLength,
    _sha256: toPostgresBytea(digest),
    _observed_content_type: observedType,
  });
  if (completionError) {
    await service.storage.from("evidence-private").remove([payload.objectKey]);
    return json(req, { error: { code: "evidence_upload_failed" }, request_id: requestIdValue }, 502);
  }

  return json(req, { data: { evidence_id: payload.evidenceId }, request_id: requestIdValue }, 201);
}

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("server_configuration");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function signTicket(payload: UploadTicketPayload): Promise<string> {
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importTicketKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return encodedPayload + "." + encodeBase64Url(new Uint8Array(signature));
}

async function verifyTicket(ticket: string): Promise<UploadTicketPayload | null> {
  if (ticket.length > 3000) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const key = await importTicketKey();
  try {
    const signature = decodeBase64Url(parts[1]);
    const valid = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(parts[0]))) as Partial<UploadTicketPayload>;
    const expiry = typeof parsed.expiresAt === "string" ? Date.parse(parsed.expiresAt) : Number.NaN;
    if (parsed.v !== 1 || typeof parsed.evidenceId !== "string" || !UUID.test(parsed.evidenceId) ||
      typeof parsed.objectKey !== "string" || !OBJECT_KEY.test(parsed.objectKey) ||
      !(parsed.userId === null || (typeof parsed.userId === "string" && UUID.test(parsed.userId))) ||
      typeof parsed.reportRef !== "string" || !/^CS-([A-F0-9]{10}|[A-F0-9]{32})$/i.test(parsed.reportRef) ||
      typeof parsed.contentType !== "string" || !ALLOWED_TYPES.has(parsed.contentType) ||
      typeof parsed.byteSize !== "number" || !Number.isSafeInteger(parsed.byteSize) || parsed.byteSize < 1 || parsed.byteSize > MAX_FILE_BYTES ||
      typeof parsed.jti !== "string" || !UUID.test(parsed.jti) ||
      !Number.isFinite(expiry) || expiry > Date.now() + 5 * 60_000 + 30_000) {
      return null;
    }
    return parsed as UploadTicketPayload;
  } catch {
    return null;
  }
}

async function getRequesterHash(req: Request): Promise<string> {
  const secret = Deno.env.get("ANONYMOUS_REPORT_HMAC_KEY") ?? "";
  let secretBytes: Uint8Array;
  try {
    secretBytes = Uint8Array.from(atob(secret), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("server_configuration");
  }
  if (secretBytes.byteLength !== 32) throw new Error("server_configuration");
  const address = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!address || address.length > 128) throw new Error("anonymous_intake_unavailable");
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`evidence:${address}`));
  return `\\x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function importTicketKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("EVIDENCE_UPLOAD_HMAC_KEY");
  if (!secret) throw new Error("server_configuration");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(secret), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("server_configuration");
  }
  if (bytes.byteLength !== 32) throw new Error("server_configuration");
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_ticket");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function toPostgresBytea(bytes: Uint8Array): string {
  return "\\x" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isSafeFileName(value: string): boolean {
  return value.length >= 1 && value.length <= 120 && !/[\\/\u0000-\u001f\u007f]/.test(value);
}

function sniffContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  return null;
}
