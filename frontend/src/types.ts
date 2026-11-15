export type AppRole =
  | "citizen"
  | "moderator"
  | "analyst"
  | "mentor"
  | "senior_reviewer"
  | "institution_liaison"
  | "platform_admin"
  | "auditor"
  | "security_admin";

export type ReportStatus =
  | "submitted"
  | "triage"
  | "needs_information"
  | "rejected"
  | "unverified_lead"
  | "under_review"
  | "accepted"
  | "closed"
  | "referred";

export interface ReportReceipt {
  report_ref: string;
  status: ReportStatus;
  received_at: string;
}

export interface OwnReport {
  report_ref: string;
  display_status: "submitted" | "under_review" | "verified_public" | "closed" | "review_complete";
  created_at: string;
  updated_at: string;
}

export interface ModerationItem {
  id: string;
  report_ref: string;
  category: string;
  channel: string;
  status: ReportStatus;
  priority: string;
  risk_score: number;
  narrative: string;
  created_at: string;
  indicator_masked: string | null;
  evidence: Array<{
    id: string;
    scan_state: "pending" | "clean" | "malicious" | "error";
    quarantine_state: "quarantined" | "released" | "rejected";
    can_preview: boolean;
  }>;
  osint_case_exists?: boolean;
}

export interface AnalystCase {
  id: string;
  case_ref: string;
  title: string;
  brief: string;
  objective: string;
  allowed_sources: string[];
  prohibited_actions: string[];
  deadline_at: string | null;
  state: string;
}

export interface AnalystClaim {
  assignment_id: string;
  case_id: string;
  case_ref: string;
  title: string;
  state: string;
  claimed_at: string;
  assigned_at: string | null;
  expires_at: string | null;
  latest_finding: {
    id: string;
    review_state: "submitted" | "accepted" | "changes_requested";
    mentor_feedback: string | null;
    confidence: number;
    submitted_at: string;
  } | null;
}

export interface AnalystProfile {
  accepted_findings: number;
  reputation_points: number;
  badges: string[];
}

export interface MentorFinding {
  finding_id: string;
  case_ref: string;
  case_title: string;
  analyst_label: string;
  summary: string;
  sources: Array<{ url: string; observed_at: string }>;
  confidence: number;
  limitations: string;
  review_state: "submitted" | "changes_requested";
  submitted_at: string;
}

export interface TeamRoom {
  id: string;
  slug: string;
  name: string;
  room_type: "osint_guild" | "moderator_sync" | "case";
  case_ref: string | null;
}

export interface TeamMessage {
  id: string;
  team_id: string;
  sender_role: "Moderator" | "Analyst" | "Mentor" | "Admin";
  body: string;
  created_at: string;
}
