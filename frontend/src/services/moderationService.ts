import type { ModerationItem, ReportStatus } from "../types";
import { invokeFunction } from "./functionClient";
import { supabase } from "./supabase";

export interface IndicatorPublicationItem {
  indicator_id: string;
  report_ref: string;
  category: string;
  channel: string;
  indicator_masked: string;
  verification_source_url: string;
  verification_note: string;
  submitted_at: string;
}

export interface EvidencePreview {
  signed_url: string;
  expires_at: string;
}

export function getModerationQueue() {
  return invokeFunction<ModerationItem[]>("moderator-review", { action: "queue", limit: 25 });
}

export function updateReportStatus(reportId: string, status: ReportStatus, reasonCode: string, safeNote: string | null = null) {
  return invokeFunction("moderator-review", {
    action: "decision",
    reportId,
    status,
    reasonCode,
    safeNote,
  });
}

export function verifyReportIndicator(reportId: string, verificationSourceUrl: string, verificationNote: string) {
  return invokeFunction<{ report_ref: string; indicator_status: string; publication_state: string }>("moderator-review", {
    action: "verify-indicator",
    reportId,
    verificationSourceUrl,
    verificationNote,
  });
}

export function getEvidencePreview(reportId: string, evidenceId: string) {
  return invokeFunction<EvidencePreview>("moderator-review", {
    action: "evidence-preview",
    reportId,
    evidenceId,
  });
}

export function getIndicatorPublicationQueue() {
  return invokeFunction<IndicatorPublicationItem[]>("approve-indicator", { action: "list" });
}

export function reviewIndicatorPublication(input: {
  indicatorId: string;
  decision: "approved" | "rejected";
  confidence: number | null;
  verificationSourceUrl: string;
  verificationNote: string;
}) {
  return invokeFunction<{ indicator_id: string; status: string }>("approve-indicator", {
    action: "decision",
    ...input,
  });
}

export async function createOsintCase(input: {
  reportId: string;
  title: string;
  brief: string;
  objective: string;
  allowedSources: string[];
}) {
  const { data, error } = await supabase.rpc("admin_create_osint_case", {
    _report_id: input.reportId,
    _title: input.title.trim(),
    _brief: input.brief.trim(),
    _objective: input.objective.trim(),
    _allowed_sources: input.allowedSources,
    _deadline_at: null,
    _max_assignments: 3,
    _correlation_id: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as { case_id: string; case_ref: string; state: string };
}
