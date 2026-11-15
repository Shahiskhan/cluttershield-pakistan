import { invokeFunction } from "./functionClient";
import { publishableKey, supabase, supabaseUrl } from "./supabase";
import type { OwnReport, ReportReceipt, ReportStatus } from "../types";

export type ReportCategory =
  | "phishing_url"
  | "impersonation"
  | "payment_fraud"
  | "delivery_fraud"
  | "investment_job_scam"
  | "other";

export type ReportChannel = "sms" | "whatsapp" | "phone_call" | "website_social_media";
export type CitizenIndicatorType = "url" | "phone";

export interface SubmitReportInput {
  category: ReportCategory;
  channel: ReportChannel;
  incidentAt: string | null;
  incidentTimezone: string;
  narrative: string;
  indicator: { type: CitizenIndicatorType; value: string };
  consent: { accepted: true; noticeVersion: "citizen-notice-1.0" };
  submissionKey: string;
}

interface SubmitReportResponse {
  report_ref: string;
  status: ReportStatus;
  received_at: string;
  idempotent_replay?: boolean;
}

interface EvidenceAuthorization {
  evidence_id: string;
  upload_ticket: string;
  expires_at: string;
}

interface EvidenceUploadResponse {
  evidence_id: string;
}

interface FunctionErrorBody {
  error?: { code?: string; message?: string };
}

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EVIDENCE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export function createSubmissionKey(): string {
  return crypto.randomUUID();
}

export async function submitReport(input: SubmitReportInput): Promise<ReportReceipt> {
  const payload = {
    ...input,
    indicator: {
      type: input.indicator.type === "phone" ? "phone_number" : "url",
      value: input.indicator.value,
    },
  };
  const response = await invokeFunction<SubmitReportResponse>("submit-report", payload);
  if (!response?.report_ref || !response.status || !response.received_at) {
    throw new Error("invalid_response");
  }
  return {
    report_ref: response.report_ref,
    status: response.status,
    received_at: response.received_at,
  };
}

export async function uploadEvidence(reportRef: string, file: File): Promise<EvidenceUploadResponse> {
  validateEvidenceFile(file);
  if (!supabaseUrl || !publishableKey) throw new Error("service_unavailable");

  const authorization = await invokeFunction<EvidenceAuthorization>("upload-evidence", {
    action: "authorize",
    reportRef,
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  });
  if (!authorization?.upload_ticket || !authorization.evidence_id) {
    throw new Error("invalid_response");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("service_unavailable");
  const bearerToken = data.session?.access_token ?? publishableKey;

  let response: Response;
  try {
    response = await fetch(new URL("/functions/v1/upload-evidence", supabaseUrl), {
      method: "PUT",
      headers: {
        apikey: publishableKey,
        Authorization: "Bearer " + bearerToken,
        "Content-Type": file.type,
        "x-evidence-ticket": authorization.upload_ticket,
      },
      body: file,
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch {
    throw new Error("evidence_upload_failed");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as FunctionErrorBody | null;
    throw new Error(body?.error?.code || mapUploadHttpError(response.status));
  }
  const body = await response.json().catch(() => null) as { data?: EvidenceUploadResponse } | null;
  if (!body?.data?.evidence_id) throw new Error("invalid_response");
  return body.data;
}

export async function getOwnReport(reportRef: string): Promise<OwnReport> {
  if (/^CS-[A-F0-9]{10}$/i.test(reportRef)) {
    const legacy = await invokeFunction<OwnReport>("get-own-report", { reportRef: reportRef.toUpperCase() });
    return legacy;
  }
  const { data, error } = await supabase.rpc("get_report_status", { _report_ref: reportRef.toUpperCase() });
  if (error || !data || typeof data !== "object") throw new Error("report_not_found");
  const result = data as Partial<OwnReport>;
  if (!result.report_ref || !result.display_status || !result.created_at || !result.updated_at) {
    throw new Error("report_not_found");
  }
  return result as OwnReport;
}

export function validateEvidenceFile(file: File): void {
  if (!ACCEPTED_EVIDENCE_TYPES.has(file.type)) throw new Error("unsupported_evidence_type");
  if (file.size < 1 || file.size > MAX_EVIDENCE_BYTES) throw new Error("evidence_size_limit");
  if (!file.name || file.name.length > 120 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) {
    throw new Error("invalid_evidence_file");
  }
}

function mapUploadHttpError(status: number): string {
  if (status === 401) return "authentication_required";
  if (status === 403) return "upload_not_authorized";
  if (status === 413) return "evidence_size_limit";
  if (status === 415) return "unsupported_evidence_type";
  if (status === 410) return "upload_ticket_expired";
  return "evidence_upload_failed";
}

export const MAX_EVIDENCE_FILE_SIZE = MAX_EVIDENCE_BYTES;
