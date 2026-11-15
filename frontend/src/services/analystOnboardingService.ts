import { supabase } from "./supabase";

export type AnalystApplicationStatus = "pending" | "approved" | "rejected";

export interface MyAnalystApplication {
  status: AnalystApplicationStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
}

export interface AnalystApplicationQueueItem {
  id: string;
  full_name: string;
  affiliation: string | null;
  portfolio_url: string | null;
  motivation: string;
  status: "pending";
  submitted_at: string;
}

export async function getMyAnalystApplication(): Promise<MyAnalystApplication | null> {
  const { data, error } = await supabase.rpc("my_analyst_application");
  if (error) throw new Error(error.message);
  return data && typeof data === "object" ? data as MyAnalystApplication : null;
}

export async function submitAnalystApplication(input: {
  fullName: string;
  affiliation: string | null;
  portfolioUrl: string | null;
  motivation: string;
}): Promise<MyAnalystApplication> {
  const { error } = await supabase.rpc("submit_analyst_application", {
    _full_name: input.fullName.trim(),
    _affiliation: input.affiliation?.trim() || null,
    _portfolio_url: input.portfolioUrl?.trim() || null,
    _motivation: input.motivation.trim(),
    _correlation_id: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  const application = await getMyAnalystApplication();
  if (!application) throw new Error("application_unavailable");
  return application;
}

export async function getAnalystApplicationQueue(): Promise<AnalystApplicationQueueItem[]> {
  const { data, error } = await supabase.rpc("admin_analyst_application_queue");
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as AnalystApplicationQueueItem[] : [];
}

export async function reviewAnalystApplication(applicationId: string, decision: "approved" | "rejected", reviewerNote: string) {
  const { data, error } = await supabase.rpc("review_analyst_application", {
    _application_id: applicationId,
    _decision: decision,
    _reviewer_note: reviewerNote.trim() || null,
    _correlation_id: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as { application_id: string; status: AnalystApplicationStatus };
}
