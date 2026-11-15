# Edge Function source

Each function is an isolated Deno entrypoint. Keep shared request parsing, authentication, URL normalization, and cryptographic protection in `_shared/`. Supabase CLI wrappers under `../supabase/functions/` import these source modules.

Function code must validate identity and active role in server/database code even when a route guard exists in the frontend. Never return narrative text, reporter contact, raw indicators, evidence paths, or analyst notes to public endpoints.
