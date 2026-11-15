import { useLanguage } from "../context/LanguageContext";
import type { TranslationKey } from "../i18n/translations";

const STATUS_TRANSLATIONS: Record<string, TranslationKey> = {
  submitted: "statusSubmitted",
  under_review: "statusUnderReview",
  verified_public: "statusVerifiedPublic",
  closed: "statusClosed",
  review_complete: "statusReviewComplete",
  triage: "statusTriaged",
  needs_information: "statusNeedsInformation",
  unverified_lead: "statusUnverified",
  referred: "statusReferred",
  rejected: "statusRejected",
  urgent: "statusUrgent",
  suspended: "statusSuspended",
  published: "statusPublished",
  available: "statusAvailable",
  sanitized: "statusSanitized",
  mentor_review: "statusMentorReview",
  case_closed: "statusCaseClosed",
  claim_requested: "statusClaimRequested",
  assigned: "statusAssigned",
  in_progress: "statusInProgress",
  findings_submitted: "statusFindingsSubmitted",
  accepted: "statusAccepted",
  changes_requested: "statusChangesRequested",
  expired: "statusExpired",
};

export function StatusPill({ status }: { status: string }) {
  const { t } = useLanguage();
  const tone = ["rejected", "closed", "expired"].includes(status) ? "quiet" :
    ["published", "accepted"].includes(status) ? "positive" :
    ["urgent", "suspended", "needs_information"].includes(status) ? "caution" : "neutral";
  const label = STATUS_TRANSLATIONS[status];
  return <span className={`status-pill status-${tone}`}>{label ? t(label) : status.replaceAll("_", " ")}</span>;
}
