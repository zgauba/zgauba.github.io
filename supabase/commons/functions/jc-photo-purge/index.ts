// Jubail Commons — pet-photo purge (T4c). Deployed to JubailCommons with verify_jwt=false:
// the caller is pg_cron (no user), so the gate is the x-jc-cron header — a single-use nonce
// minted by the cron command, spent here via jc_cron_nonce_use (unused, < 10 min old).
// Malformed headers are refused before any database call. Plan: docs/plans/T4-instrumentation.md.
//
// Every run ends in jc_photo_purge_done, which writes jc_maintenance_log — including the
// first Storage error. Runtime logs are not SQL-queryable, so a failure that only reached
// console.error would be invisible to the admin report.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "pet-photos";
const BATCH = 100;

const NONCE = /^[0-9a-f]{48}$/;

Deno.serve(async (req: Request) => {
  const nonce = req.headers.get("x-jc-cron") ?? "";
  if (req.method !== "POST" || !NONCE.test(nonce)) return json(403, { error: "forbidden" });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: allowed, error: nonceErr } = await db.rpc("jc_cron_nonce_use", {
    p_nonce: nonce,
    p_job: "photo_purge",
  });
  if (nonceErr) return json(500, { error: "gate_check_failed" });
  if (allowed !== true) return json(403, { error: "forbidden" });

  let firstError: string | null = null;
  let paths: string[] = [];

  const { data: queue, error: queueErr } = await db.rpc("jc_photo_purge_queue", { p_limit: BATCH });
  if (queueErr) firstError = `queue: ${queueErr.message}`;
  else paths = (queue as string[] | null) ?? [];

  if (!firstError && paths.length > 0) {
    // Paths that were never uploaded (abandoned pending) are simply absent — not an error.
    const { error: rmErr } = await db.storage.from(BUCKET).remove(paths);
    if (rmErr) firstError = `storage: ${rmErr.message}`;
  }

  const { data: marked, error: doneErr } = await db.rpc("jc_photo_purge_done", {
    p_paths: paths,
    p_error: firstError,
  });
  if (doneErr) return json(500, { error: `done: ${doneErr.message}`, first_error: firstError });

  return json(firstError ? 500 : 200, { queued: paths.length, purged: marked, error: firstError });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
