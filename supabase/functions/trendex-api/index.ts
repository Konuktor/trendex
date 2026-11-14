// Optional Supabase Edge Function wrapper around router.ts (the site itself is fully static; see client.ts).
// Deploy: supabase functions deploy trendex-api --no-verify-jwt --project-ref <ref>
import { route, setBase } from "./router.ts";

const SUPA = Deno.env.get("SUPABASE_URL") ?? "";
setBase(Deno.env.get("TRENDEX_STORAGE") ?? `${SUPA}/storage/v1/object/public/trendex/v1`);
Deno.serve(route);
