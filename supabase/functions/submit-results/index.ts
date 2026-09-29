// Receives one evaluation run from the app and stores it in eval_runs / eval_rows.
//
// POST /functions/v1/submit-results, header `apikey: <publishable key>`, JSON body:
//   { installId, run: { runId, evalSetVersion, appVersion, platform, osVersion?, deviceBrand?,
//     deviceModel?, soc?, socManufacturer?, hardware?, apiLevel?, ramBytes?, cpuCores?,
//     cpuFeatures?: string[], coreMaxFreqKHz?: number[] }, rows: [<eval JSONL row>, ...] }
//
// After saving the rows it computes each model's score (compute_eval_scores, score v1) into the
// public eval_scores table; the score is never taken from the app.
//
// The publishable key is public (it ships in the APK), so it only keeps out random callers;
// the limits below are what protect the tables. verify_jwt is off (supabase/config.toml)
// because the new API keys aren't JWTs.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_RUNS_PER_DAY = 20;
// The install id is chosen by the caller, so the per-install limit alone can be dodged by
// sending a new id each time. This cap on all submissions doesn't depend on the caller.
const MAX_RUNS_PER_HOUR_ALL = 300;
const MAX_ANSWER_CHARS = 8000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function keys(name: string): string[] {
  try {
    return Object.values(JSON.parse(Deno.env.get(name) ?? "{}")) as string[];
  } catch {
    return [];
  }
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const posInt = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};
/** Short lowercase CPU flags like "i8mm" or "asimddp", at most 100 of them. */
const cpuFlags = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((f) => typeof f === "string" && /^[a-z0-9_]{1,32}$/.test(f)).slice(0, 100) : null;
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
/** Core frequencies in kHz (0 = unknown), at most 64 cores. */
const freqs = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length <= 64 && v.every((f) => Number.isInteger(f) && f >= 0 && f < 10_000_000) ? v : null;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!keys("SUPABASE_PUBLISHABLE_KEYS").includes(req.headers.get("apikey") ?? "")) {
    return json(401, { error: "invalid apikey" });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "body too large" });
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const installId = str(body?.installId, 100);
  const run = body?.run ?? {};
  const rows: unknown[] = Array.isArray(body?.rows) ? body.rows : [];
  const runId = str(run.runId, 100);
  const evalSetVersion = str(run.evalSetVersion, 20);
  const appVersion = str(run.appVersion, 40);
  const platform = run.platform === "android" || run.platform === "ios" ? run.platform : null;
  if (!installId || !runId || !evalSetVersion || !appVersion || !platform) {
    return json(400, { error: "installId, run.runId, run.evalSetVersion, run.appVersion and run.platform are required" });
  }
  if (rows.length === 0 || rows.length > MAX_ROWS) return json(400, { error: `rows must hold 1 to ${MAX_ROWS} items` });

  const records = [];
  for (const r of rows as any[]) {
    const queryId = str(r?.queryId, 100);
    const configId = str(r?.configId, 200);
    const outcome = str(r?.outcome, 40);
    if (!queryId || !configId || !outcome) return json(400, { error: "each row needs queryId, configId and outcome" });
    const data = { ...r };
    if (typeof data.answer === "string") data.answer = data.answer.slice(0, MAX_ANSWER_CHARS);
    // The fields compute_eval_scores casts: anything malformed becomes null instead of failing the run
    // (tokensGenerated becomes a Postgres int, so at most 2^31 - 1).
    const tokens = int(r.tokensGenerated);
    data.tokensGenerated = tokens !== null && tokens <= 2_147_483_647 ? tokens : null;
    data.peakRssBytes = int(r.peakRssBytes);
    data.timedOut = bool(r.timedOut);
    data.expectedKbHit = bool(r.expectedKbHit);
    data.configLabel = str(r.configLabel, 200);
    records.push({
      query_id: queryId,
      config_id: configId,
      model_id: str(r.modelId, 200),
      outcome,
      ttft_ms: num(r.ttftMs),
      tok_per_sec: num(r.tokPerSec),
      total_latency_ms: num(r.totalLatencyMs),
      data,
    });
  }

  const secret = keys("SUPABASE_SECRET_KEYS")[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, secret!, { auth: { persistSession: false } });
  const submitterHash = await sha256(installId);

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countError } = await db
    .from("eval_runs")
    .select("id", { count: "exact", head: true })
    .eq("submitter_hash", submitterHash)
    .gte("received_at", since);
  if (countError) return json(500, { error: "could not check the rate limit" });
  if ((count ?? 0) >= MAX_RUNS_PER_DAY) return json(429, { error: "too many runs today" });
  const { count: hourCount, error: hourError } = await db
    .from("eval_runs")
    .select("id", { count: "exact", head: true })
    .gte("received_at", new Date(Date.now() - 3600 * 1000).toISOString());
  if (hourError) return json(500, { error: "could not check the rate limit" });
  if ((hourCount ?? 0) >= MAX_RUNS_PER_HOUR_ALL) return json(429, { error: "too many runs right now" });

  const { data: inserted, error: runError } = await db
    .from("eval_runs")
    .insert({
      submitter_hash: submitterHash,
      run_id: runId,
      eval_set_version: evalSetVersion,
      app_version: appVersion,
      platform,
      os_version: str(run.osVersion, 40),
      device_brand: str(run.deviceBrand, 80),
      device_model: str(run.deviceModel, 80),
      soc: str(run.soc, 80),
      soc_manufacturer: str(run.socManufacturer, 80),
      hardware: str(run.hardware, 80),
      api_level: posInt(run.apiLevel),
      ram_bytes: posInt(run.ramBytes),
      cpu_cores: posInt(run.cpuCores),
      cpu_features: cpuFlags(run.cpuFeatures),
      core_max_khz: freqs(run.coreMaxFreqKHz),
      row_count: records.length,
    })
    .select("id")
    .single();
  if (runError) {
    // 23505: this install already sent this run.
    if (runError.code === "23505") return json(409, { error: "run already submitted" });
    return json(500, { error: "could not save the run" });
  }

  const { error: rowsError } = await db.from("eval_rows").insert(records.map((r) => ({ ...r, run: inserted.id })));
  if (rowsError) {
    await db.from("eval_runs").delete().eq("id", inserted.id);
    return json(500, { error: "could not save the rows" });
  }
  const { error: scoreError } = await db.rpc("compute_eval_scores", { p_run: inserted.id });
  if (scoreError) {
    await db.from("eval_runs").delete().eq("id", inserted.id);
    return json(500, { error: "could not score the run" });
  }
  const { data: scores } = await db
    .from("eval_scores")
    .select("config_id, score, median_tok_per_sec, median_ttft_ms, peak_rss_bytes")
    .eq("run", inserted.id);
  return json(201, { id: inserted.id, rows: records.length, scores: scores ?? [] });
});
