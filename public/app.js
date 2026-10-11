// Ring Radar dashboard: state machine + event stream.
// The engine sends one `snapshot` per tick on /events. We keep only the newest,
// derive the screen phase from it, and render once per animation frame.
// Phases: watching -> suspicious -> incident -> resolved (body[data-phase] drives CSS).

import { suspiciousAccounts } from "./util.js";
import * as header from "./header.js";
import * as status from "./status.js";
import * as map from "./map.js";
import * as incident from "./incident.js";
import * as drawer from "./drawer.js";
import * as controls from "./controls.js";

export const state = {
  phase: "watching",   // watching | suspicious | incident | resolved
  snap: null,          // newest snapshot
  case: "active",      // active | sent | released (local: the bank's decision)
  view: "network",     // network | trail
  lastTick: -1,
};

const modules = [header, status, map, incident, drawer, controls];

/* ---------- derived phase ---------- */

function derivePhase(s) {
  if ((s.phase || 0) >= 1) return state.case === "active" ? "incident" : "resolved";
  return suspiciousAccounts(s).length ? "suspicious" : "watching";
}

/* ---------- render loop (one frame per snapshot burst) ---------- */
let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const s = state.snap;
    if (!s) return;
    // A tick going backwards means New run: clear everything local.
    if (s.tick < state.lastTick) resetLocal();
    state.lastTick = s.tick;
    setPhase(derivePhase(s));
    for (const m of modules) m.render && m.render(s, state);
  });
}

function setPhase(p) {
  if (state.phase === p) return;
  state.phase = p;
  document.body.dataset.phase = p;
  for (const m of modules) m.onPhase && m.onPhase(p, state);
}

function resetLocal() {
  state.case = "active";
  state.view = "network";
  for (const m of modules) m.reset && m.reset(state);
}

/* ---------- actions other modules can call ---------- */
const api = {
  rerender: schedule,
  newRun() { resetLocal(); state.lastTick = -1; setPhase("watching"); },
  setCase(c) { state.case = c; schedule(); },
  setView(v) {
    if (v === "trail" && (state.snap?.phase || 0) < 1) return;
    state.view = v;
    map.showView(v);
    schedule();
  },
};

modules.forEach((m) => m.init && m.init(state, api));

/* ---------- event stream with backoff reconnect ---------- */
let es = null, backoff = 1000;
function connect() {
  es = new EventSource("/events");
  es.onopen = () => { backoff = 1000; header.setLive(true); };
  es.onmessage = (e) => {
    try { state.snap = JSON.parse(e.data); schedule(); }
    catch (err) { console.error("bad snapshot", err); }
  };
  es.onerror = () => {
    header.setLive(false);
    es.close();
    // Reconnect after 1s, 2s, 4s ... capped at 10s.
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10000);
  };
}
connect();
