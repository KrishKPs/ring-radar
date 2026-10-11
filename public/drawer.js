// Case drawer: slides up over the map + ticker once the case file is ready (engine phase 5).
// Holds the per-victim money trail, the timeline, and the only Release / Send-to-police buttons.

import { byId, esc, money, shortName, setHTML, setText, post, clockSec, toast } from "./util.js";

let api = null, stateRef = null;
let opened = false;      // auto-opened once this run
let minimized = false;

export function init(state, a) {
  api = a; stateRef = state;
  byId("drawer-min").onclick = () => setMin(true);
  byId("drawer-tab").onclick = () => setMin(false);
  byId("drawer-handle").onclick = () => setMin(true);
  byId("d-police").onclick = sendToPolice;
  byId("d-release").onclick = confirmRelease;
  byId("d-copy").onclick = () => {
    const cf = stateRef.snap?.caseFile;
    if (cf && navigator.clipboard) navigator.clipboard.writeText(cf).then(() => toast("Case file copied"));
  };
  byId("modal-cancel").onclick = () => { byId("modal").hidden = true; };
}

export function reset() {
  opened = false; minimized = false;
  byId("drawer").hidden = true;
  byId("drawer").classList.remove("min");
  setText(byId("d-police"), "Send case to police");
  byId("d-police").disabled = false;
  byId("d-release").disabled = false;
}

/** C key: open / minimize the drawer (only once a case exists). */
export function toggle() { if (opened) setMin(!minimized); }

function setMin(m) {
  minimized = m;
  byId("drawer").classList.toggle("min", m);
}

export function render(s, state) {
  if (!s.caseFile) return;
  if (!opened) { opened = true; byId("drawer").hidden = false; }
  const t = s.totals || {}, parcels = s.parcels || [];
  const acc = {}; for (const a of s.accounts || []) acc[a.id] = a;
  const ring = (s.accounts || []).filter((a) => a.kind === "acct" && a.frozen).length;
  const involved = parcels.reduce((n, p) => n + p.amount, 0);
  const refused = parcels.filter((p) => p.status === "refused").length;

  const badge = state.case === "sent" ? ["info", "Sent to police"] : state.case === "released" ? ["safe", "Released"] : ["danger", "Frozen"];
  const b = byId("d-badge");
  b.className = "badge " + badge[0];
  setText(b, badge[1]);
  setHTML(byId("d-stats"),
    stat((t.scored || 0).toLocaleString("en-US"), "scored") + stat(ring, "ring") + stat(money(involved), "involved") +
    stat(money(t.stopped), "stopped", "safe") + stat(money(t.lost), "cashed out", t.lost ? "danger" : "") + stat(refused, "refused"));
  setText(byId("drawer-tab"), "CASE RR-0001 · " + badge[1] + " · " + money(t.stopped) + " stopped");

  renderRows(parcels, acc);
  renderTimeline(s);
}

function stat(v, k, cls = "") { return '<span class="ds"><b class="' + cls + '">' + esc(v) + "</b> " + esc(k) + "</span>"; }

const OUTCOME = { stopped: ["safe", "STOPPED"], lost: ["danger", "CASHED OUT"], refused: ["warn", "REFUSED"], moving: ["dim", "MOVING"] };
function renderRows(parcels, acc) {
  const html = parcels.map((p) => {
    const o = OUTCOME[p.status] || OUTCOME.moving;
    const hops = (p.path || []).filter((id) => id !== "OUT")
      .map((id) => '<span class="hop mono">' + esc(acc[id] ? shortName(acc[id]) : id) + "</span>").join('<span class="arrow">→</span>');
    return '<div class="vrow"><span class="v-name">' + esc(acc[p.victim]?.name || p.victim) + ' <span class="mono dim">' + money(p.amount) + "</span></span>" +
      '<span class="v-hops">' + (hops ? '<span class="arrow">→</span>' + hops : "") + '<span class="arrow">→</span></span><span class="outcome ' + o[0] + '">' + o[1] + "</span></div>";
  }).join("");
  setHTML(byId("d-rows"), html);
}

// Key log lines, oldest first, as offsets from ring detection ("+30s").
function renderTimeline(s) {
  const t0 = clockSec((s.phaseClock || [])[1]);
  const lines = (s.log || []).filter((l) => l.key).slice(0, 14).reverse();
  const html = lines.map((l) => {
    const at = clockSec(l.clock), off = t0 != null && at != null ? (at >= t0 ? "+" : "") + (at - t0) + "s" : l.clock;
    const tone = /frozen|refused/i.test(l.text) ? "danger" : /stopped|released/i.test(l.text) ? "safe" : "";
    return '<li><span class="tl-dot ' + tone + '"></span><span class="tl-t mono">' + esc(off) + '</span><span class="tl-x">' + esc(l.text) + "</span></li>";
  }).join("");
  setHTML(byId("d-timeline"), html);
}

/* ---------- actions ---------- */
function sendToPolice() {
  // No police API in the sandbox: this records the analyst's decision on screen.
  api.setCase("sent");
  setText(byId("d-police"), "✓ Sent to police");
  byId("d-police").disabled = true;
  toast("Case RR-0001 sent to police");
}

function confirmRelease() {
  const frozen = (stateRef.snap?.accounts || []).filter((a) => a.frozen);
  setText(byId("modal-text"), "Unfreeze " + frozen.length + " accounts and close case RR-0001?");
  byId("modal").hidden = false;
  byId("modal-ok").onclick = async () => {
    byId("modal").hidden = true;
    for (const a of frozen) await post("/api/release", { id: a.id });
    api.setCase("released");
    byId("d-release").disabled = true;
    toast("Case RR-0001 released");
  };
}
