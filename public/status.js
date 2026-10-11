// Left status card: current state (headline), response steps (Act 2), trust line (eval numbers).

import { byId, esc, money, setHTML, setText, clockSec, suspiciousAccounts, reducedMotion } from "./util.js";

let lastKey = "";

export function init() {
  // Trust line: numbers written by `npm run eval -- 100` to public/eval.json. Never hardcoded.
  fetch("/eval.json").then((r) => (r.ok ? r.json() : null)).then((e) => {
    if (!e) return;
    setHTML(byId("st-trust"),
      '<div class="trust-head">Tested on ' + esc(e.runs) + " unseen attacks</div>" +
      '<div class="trust-stats mono"><span class="safe">' + esc(e.detectionRate) + " caught</span>" +
      '<span class="' + (e.innocentFrozen === 0 ? "safe" : "danger") + '">' + esc(e.innocentFrozen) + " innocent frozen</span>" +
      "<span>" + esc(e.moneyStoppedShare) + " money stopped</span></div>");
  }).catch(() => {});
}

export function render(s, state) {
  const v = describe(s, state);
  const dot = byId("st-dot");
  dot.className = "st-dot " + v.tone;
  setText(byId("st-label"), v.label);
  setText(byId("st-headline"), v.headline);
  setText(byId("st-sub"), v.sub);
  // Cross-fade the headline whenever the state (not just a number) changes.
  if (v.key !== lastKey) {
    lastKey = v.key;
    if (!reducedMotion) { const w = byId("st-swap"); w.classList.remove("swap"); void w.offsetWidth; w.classList.add("swap"); }
  }
  renderSteps(s);
}

export function reset() { lastKey = ""; }

/** What the status card should say right now. */
function describe(s, state) {
  const t = s.totals || {}, accts = s.accounts || [];
  if (state.phase === "resolved") {
    return state.case === "sent"
      ? { key: "sent", tone: "info", label: "SENT TO POLICE", headline: "Case RR-0001 sent to police", sub: money(t.stopped) + " stopped. " + money(t.lost) + " cashed out before the freeze." }
      : { key: "released", tone: "safe", label: "RELEASED", headline: "Ring accounts released", sub: "An analyst reviewed the case and unfroze the accounts." };
  }
  if (state.phase === "incident") {
    // Frozen ring accounts (includes accounts frozen later by the "extended" rule).
    const size = accts.filter((a) => a.kind === "acct" && a.frozen).length || (s.metrics || {}).ringSize || 0;
    const victims = new Set((s.parcels || []).map((p) => p.victim)).size;
    const frozen = (s.phase || 0) >= 2;
    return {
      key: "incident-" + frozen + "-" + s.wave2, tone: "danger", label: "RING CAUGHT",
      headline: "Ring of " + size + " accounts " + (frozen ? "frozen" : "detected"),
      sub: wave2Line(s) || (money(t.stopped) + " stopped from " + victims + " victim" + (victims === 1 ? "" : "s")),
    };
  }
  if (state.phase === "suspicious") {
    const n = suspiciousAccounts(s).length;
    return {
      key: "suspicious", tone: "warn", label: "SUSPICIOUS ACTIVITY",
      headline: n + (n === 1 ? " account acting strangely" : " accounts acting strangely"),
      sub: "Money from strangers, passed on within minutes.",
    };
  }
  return {
    key: "watching", tone: "safe", label: "WATCHING",
    headline: accts.length ? accts.length + " accounts. No ring." : "Watching the network",
    sub: "Normal day: paychecks, rent, groceries. Every transfer is scored live.",
  };
}

// Narration for the scammers' second wave.
function wave2Line(s) {
  if (s.wave2 === "running") return s.backupKnownBeforeWave2
    ? "Scammers switched to their backup account. The holder already told us about it."
    : "Scammers switched to a backup account nobody told us about.";
  if (s.wave2 === "done") return s.backupKnownBeforeWave2
    ? "Second wave refused: one honest answer exposed the backup account."
    : "Second wave caught, after some money left.";
  return "";
}

/* ---------- response steps (step i is done once the engine reaches phase i) ---------- */
function renderSteps(s) {
  const phase = s.phase || 0, pc = s.phaseClock || [], t = s.totals || {};
  const victims = new Set((s.parcels || []).map((p) => p.victim)).size;
  const labels = ["Ring detected", (t.frozen || 0) + " accounts frozen", "Money traced · " + victims + " victims",
    "Texting victim & holder", "Case file ready"];
  const t0 = clockSec(pc[1]);
  let html = "", filled = 0;
  for (let i = 1; i <= 5; i++) {
    const done = phase >= i, active = phase + 1 === i && phase >= 1;
    if (done) filled = i;
    const at = clockSec(pc[i]);
    const time = done && t0 != null && at != null ? "+" + (at - t0) + "s" : "";
    html += '<li class="' + (done ? "done" : active ? "active" : "pending") + '"><span class="mark"></span>' +
      '<span class="s-lbl">' + esc(labels[i - 1]) + '</span><span class="s-time mono">' + time + "</span></li>";
  }
  const el = byId("steps");
  setHTML(el, html);
  // The connecting line fills as steps complete.
  el.style.setProperty("--fill", filled <= 1 ? "0" : String((filled - 1) / 4));
}
