export function StatusPill({ status }: { status: string }) {
  const tone = ["rejected", "closed", "expired"].includes(status) ? "quiet" :
    ["published", "accepted"].includes(status) ? "positive" :
    ["urgent", "suspended", "needs_information"].includes(status) ? "caution" : "neutral";
  return <span className={`status-pill status-${tone}`}>{status.replaceAll("_", " ")}</span>;
}
