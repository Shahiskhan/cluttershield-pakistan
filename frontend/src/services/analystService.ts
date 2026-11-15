import type { AnalystCase, AnalystClaim, AnalystProfile, MentorFinding } from "../types";
import { invokeFunction } from "./functionClient";

export interface AnalystWorkspace {
  available: AnalystCase[];
  my_claims: AnalystClaim[];
  profile: AnalystProfile;
}

export function getAnalystWorkspace() {
  return invokeFunction<AnalystWorkspace>("analyst-cases", { action: "list" });
}

export function requestCaseClaim(caseId: string, conflictsReviewed: boolean) {
  return invokeFunction<{ assignment_id: string; state: string; expires_at: string }>("analyst-cases", {
    action: "claim",
    caseId,
    conflictsReviewed,
  });
}

export interface FindingSourceInput {
  url: string;
  observedAt: string;
}

export function submitFinding(input: {
  assignmentId: string;
  summary: string;
  sources: FindingSourceInput[];
  confidence: number;
  limitations: string;
}) {
  return invokeFunction<{ finding_id: string; review_state: "submitted"; submitted_at: string }>("submit-finding", {
    action: "submit",
    ...input,
  });
}

export function getMentorReviewQueue() {
  return invokeFunction<MentorFinding[]>("analyst-cases", { action: "mentor-queue" });
}

export function reviewFinding(input: {
  findingId: string;
  decision: "accepted" | "changes_requested";
  feedback: string;
}) {
  return invokeFunction<{ finding_id: string; review_state: string }>("submit-finding", {
    action: "review",
    ...input,
  });
}
