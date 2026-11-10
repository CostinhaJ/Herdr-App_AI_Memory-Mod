// ai-memory panel: for each project an agent is working in, what ai-memory
// knows (pages, pending messages, open handoffs) and whether capture works.
// Herdr API used: terminals, exec, theme, run("agent.focus").
// ai-memory access lives in ./data.js (JSON only).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, theme, run } from "herdr";
import { loadGlobal, loadFolder, ago } from "./data.js";

const FULL_MS = 60000; // full refresh (doctor costs ~0.7 s per folder)
const WATCH_MS = 5000; // cheap check for agents in new folders

const AGENT_KEYS = new Set(["claude", "codex", "gemini", "opencode", "pi", "cursor-agent", "aider", "amp", "goose", "copilot"]);

const pick = (o, k, d) => (o && typeof o[k] === "string" ? o[k] : d);

export default class AiMemory extends View {
  init(_props, cx) {
    this.global = null;
    this.byCwd = {}; // cwd -> project view (or null: not an ai-memory project)
    this.lastRun = null;
    this.busy = false;
    this.seen = "";
    cx.timer.every(FULL_MS, (cx) => this.refresh(cx));
    cx.timer.every(WATCH_MS, (cx) => {
      if (this.folderKey() !== this.seen) this.refresh(cx);
    });
    this.refresh(cx);
  }

  /** Live local agent terminals with their folder, from terminals() alone
   *  (agents() only lists programs that already reported a status).
   *  Several signals, so a renamed field in a herdr update degrades gently:
   *  the agent's report, program.agent, a known agent program, or hc's `agent`.
   *  Remote ones (machine/tN) are skipped. */
  localAgents() {
    let ts = [];
    try { ts = terminals() ?? []; } catch (_e) {}
    const isAgent = (t) =>
      (t.report && typeof t.report === "object") ||
      t.program?.agent === true ||
      AGENT_KEYS.has(t.program?.key) ||
      (typeof t.agent === "string" && t.agent.length > 0);
    return ts
      .filter((t) => t && typeof t.address === "string" && !t.address.includes("/"))
      .filter((t) => t.state === undefined || t.state === "live")
      .filter((t) => typeof t.cwd === "string" && t.cwd.length > 0)
      .filter(isAgent)
      .map((t) => ({
        address: t.address,
        name: typeof t.name === "string" ? t.name : null,
        status: [t.status, t.report?.state].find((x) => typeof x === "string") ?? "idle",
        app: [t.report?.app, t.program?.name, t.agent].find((x) => typeof x === "string") ?? "",
        cwd: t.cwd,
      }));
  }

  folderKey() {
    return [...new Set(this.localAgents().map((a) => a.cwd))].sort().join("\n");
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    this.seen = this.folderKey();
    const folders = this.seen ? this.seen.split("\n") : [];
    cx.spawn(async (cx) => {
      try {
        const global = await loadGlobal();
        const byCwd = {};
        if (global.ok) for (const f of folders) byCwd[f] = await loadFolder(f, global);
        this.global = global;
        this.byCwd = byCwd;
        this.lastRun = new Date().toISOString();
      } catch (_e) {
        this.global = { ok: false };
      } finally {
        this.busy = false;
      }
      cx.notify();
    });
  }

  /** Agents grouped by ai-memory project; folders outside one go in `other`. */
  groups() {
    const projects = {};
    const other = [];
    for (const a of this.localAgents()) {
      const p = this.byCwd[a.cwd];
      if (!p) { other.push(a); continue; }
      (projects[p.key] ??= { view: p, agents: [] }).agents.push(a);
    }
    return { projects: Object.values(projects), other };
  }

  render(cx) {
    const t = theme();
    const c = (k, d) => pick(t, k, d);
    const fg = c("foreground", "#ddd"), muted = c("muted", "#999"), dim = c("dim", "#777");
    const g = this.global;
    const { projects, other } = this.groups();

    const dot = (status) => div().w(7).h(7).rounded(4).bg(c(status, c("unknown", dim)));

    const agentRow = (a) =>
      h_flex().id(`a-${a.address}`).gap(6).items_center().px(4).rounded(4)
        .hover((s) => s.bg(c("hover", c("raised", "#333"))))
        .on_click(() => run("agent.focus", { terminal: a.address }))
        .child(dot(a.status))
        .child(div().text_color(fg).child(a.name ? `${a.address} ${a.name}` : a.address))
        .child(div().flex_1().truncate().text_color(dim).child(`${a.app ?? ""} ${a.status}`));

    const line = (label, value, color) =>
      h_flex().justify_between().gap(8)
        .child(div().text_color(muted).child(label))
        .child(div().truncate().text_color(color ?? fg).child(value));

    const card = ({ view: p, agents: as }) => {
      const pages = p.pages === null ? "—" : `${p.pages}${p.lastUpdated ? " · " + ago(p.lastUpdated) : ""}`;
      const msgs = !p.messagesOk ? "—" : String(p.messages.length);
      const hand = p.handoffs === null ? "—" : String(p.handoffs);
      return v_flex().gap(4).p(8).rounded(6).bg(c("raised", "#2a2a2a"))
        .child(h_flex().justify_between().gap(6)
          .child(div().font_semibold().truncate().text_color(fg).child(p.project))
          .child(div().text_color(dim).child(p.workspace)))
        .children(as.map(agentRow))
        .child(line("páginas", pages))
        .child(line("mensagens", msgs, p.messages.length ? c("blocked", fg) : fg))
        .children(p.messages.slice(0, 3).map((m) =>
          div().pl(10).truncate().text_color(muted).child(`✉ ${m.subject}${m.at ? " · " + ago(m.at) : ""}`)))
        .child(line("handoffs abertos", hand, p.handoffs ? c("blocked", fg) : fg))
        .children(p.warnings.map((w) => div().text_color(c("blocked", c("ansi1", fg))).child(`⚠ ${w}`)));
    };

    const header = h_flex().justify_between().items_center().gap(8)
      .child(div().font_semibold().text_color(fg).child("ai-memory"))
      .child(h_flex().gap(6).items_center()
        .child(div().w(7).h(7).rounded(4).bg(g === null ? dim : g.ok ? c("ansi2", fg) : c("blocked", c("ansi1", fg))))
        .child(div().text_color(dim).child(g === null ? "a carregar…" : g.ok ? `v${g.version ?? "?"}` : "sem servidor"))
        .child(div().id("refresh").px(4).rounded(4).text_color(muted)
          .hover((s) => s.bg(c("hover", "#333")))
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.busy ? "…" : "↻")));

    const body = [];
    if (g && !g.ok) {
      body.push(div().text_color(muted).child("O servidor ai-memory não respondeu. Verifica com `ai-memory status`."));
    }
    body.push(...projects.map(card));
    if (other.length) {
      body.push(v_flex().gap(2).p(8)
        .child(div().text_color(dim).child("fora de projetos ai-memory"))
        .children(other.map(agentRow)));
    }
    if (g && g.ok && !projects.length && !other.length) {
      body.push(div().text_color(muted).child("Nenhum agente local ativo."));
    }

    const footer = div().text_color(dim).child(
      this.lastRun ? `atualizado ${ago(this.lastRun)}${g?.spoolPending ? ` · spool ${g.spoolPending}` : ""}` : "");

    return v_flex().id("root").size_full().bg(c("surface", "#1e1e1e")).p(10).gap(8).text_size(12)
      .child(header)
      .child(v_flex().id("list").flex_1().gap(8).overflow_y_scrollbar().children(body))
      .child(footer);
  }
}
