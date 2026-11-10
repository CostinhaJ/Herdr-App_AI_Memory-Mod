// Everything this mod knows about ai-memory goes through here, and only
// through `ai-memory ... --json`. If an ai-memory update changes a field,
// fix it in this file only; the UI reads the normalized shape below.
//
// Normalized project shape:
//   { key, workspace, project, pages, lastUpdated, messages: [{subject, from, at}],
//     handoffs, warnings: [string], ok }
import { exec } from "herdr";

const BIN = "ai-memory";

/** Runs `ai-memory <args> --json`; returns parsed JSON or null. Never throws. */
export async function aiJson(args, cwd) {
  try {
    const r = await exec(BIN, [...args, "--json"], cwd ? { cwd } : undefined);
    if (r.code !== 0) return null;
    const out = r.stdout.trim();
    // Logs go to stderr, but be tolerant: start at the first JSON bracket.
    const i = out.search(/[\[{]/);
    return i < 0 ? null : JSON.parse(out.slice(i));
  } catch (_e) {
    return null;
  }
}

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : null);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/** Server-wide facts: version, reachability, every project's page count. */
export async function loadGlobal() {
  const status = await aiJson(["status"]);
  const projects = await aiJson(["list-projects"]);
  const byKey = {};
  for (const p of arr(projects)) {
    const ws = str(p?.workspace_name), pr = str(p?.project_name);
    if (ws && pr) byKey[`${ws}/${pr}`] = { pages: num(p?.page_count), lastUpdated: str(p?.last_updated) };
  }
  return {
    ok: status !== null,
    version: str(status?.version),
    spoolPending: num(status?.spool?.pending),
    projects: byKey,
  };
}

/** Which project a folder maps to, plus capture problems there. */
async function resolveFolder(cwd) {
  const d = await aiJson(["doctor"], cwd);
  if (!d) return null;
  const workspace = str(d.workspace), project = str(d.project);
  if (!workspace || !project) return null;
  const warnings = [];
  if (d.server_unreachable === true) warnings.push("servidor inacessível");
  for (const u of arr(d.uncaptured)) {
    const name = str(u?.agent) ?? str(u);
    if (name) warnings.push(`${name} sem captura`);
  }
  const skipped = arr(d.codex_hooks?.skipped).length;
  if (skipped > 0) warnings.push(`Codex: ${skipped} hooks por aprovar (/hooks)`);
  const cp = d.capture_coverage_problem;
  if (cp && typeof cp === "string") warnings.push(cp);
  return { workspace, project, warnings };
}

/** Full per-project view for a folder. */
export async function loadFolder(cwd, global) {
  const r = await resolveFolder(cwd);
  if (!r) return null;
  const scope = ["--workspace", r.workspace, "--project", r.project];
  const msgs = await aiJson(["message", "list", ...scope]);
  const hand = await aiJson(["handoffs", ...scope]);
  const key = `${r.workspace}/${r.project}`;
  const g = global?.projects?.[key] ?? {};
  return {
    key,
    workspace: r.workspace,
    project: r.project,
    pages: g.pages ?? null,
    lastUpdated: g.lastUpdated ?? null,
    messages: arr(msgs)
      .filter((m) => (str(m?.state) ?? "pending") === "pending")
      .map((m) => ({ subject: str(m?.subject) ?? "(sem assunto)", at: str(m?.created_at) })),
    messagesOk: msgs !== null,
    handoffs: hand === null ? null : arr(hand).length,
    warnings: r.warnings,
  };
}

/** "há 3 min" style age from an ISO date; "" when unknown. */
export function ago(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}
