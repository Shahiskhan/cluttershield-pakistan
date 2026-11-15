import { supabase } from "./supabase";

interface FunctionEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
  request_id?: string;
}

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(name, { body });
  if (error) {
    const context = error.context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as FunctionEnvelope<T> | null;
      if (payload?.error?.code) throw new Error(payload.error.code);
    }
    throw new Error("request_failed");
  }
  if (data?.error) throw new Error(data.error.code || "request_failed");
  if (data && "data" in data) return data.data as T;
  return data as T;
}
