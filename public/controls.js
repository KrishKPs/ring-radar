// Demo controls, hidden from judges: gear popover + keyboard shortcuts.
// A launch · N new run · Space pause · G regroup · M money trail · C case drawer · R reset zoom.

import { byId, setText, post } from "./util.js";
import { resetZoom, closeExplain } from "./map.js";
import { toggle as toggleDrawer } from "./drawer.js";

let api = null, stateRef = null, paused = false;

export function init(state, a) {
  api = a; stateRef = state;
  const pop = byId("controls");
  byId("gear").onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });

  byId("c-launch").onclick = launch;
  byId("c-reset").onclick = newRun;
  byId("c-pause").onclick = togglePause;
  byId("c-regroup").onclick = regroup;
  byId("c-speed").oninput = (e) => {
    const x = Number(e.target.value);
    setText(byId("c-speed-v"), x + "×");
    post("/api/speed", { ms: Math.round(600 / x) });   // the server clamps to 300..1200 ms per tick
  };
  document.querySelectorAll("#seg .seg-btn").forEach((b) => { b.onclick = () => api.setView(b.dataset.view); });

  document.addEventListener("keydown", onKey);
}

export function render(s) {
  byId("c-regroup").disabled = s.wave2 !== "ready";
}

function onKey(e) {
  if (e.target.closest && e.target.closest("input, textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "a") launch();
  else if (k === "n") newRun();
  else if (k === " ") { e.preventDefault(); togglePause(); }
  else if (k === "g") regroup();
  else if (k === "m") api.setView(stateRef.view === "trail" ? "network" : "trail");
  else if (k === "c") toggleDrawer();
  else if (k === "r") resetZoom();
  else if (k === "escape") { byId("controls").hidden = true; closeExplain(); byId("modal").hidden = true; }
}

function launch() { post("/api/launch"); }
function regroup() { if (stateRef.snap?.wave2 === "ready") post("/api/regroup"); }
function newRun() { api.newRun(); post("/api/reset"); }
function togglePause() {
  post("/api/pause").then((r) => {
    if (r && typeof r.paused === "boolean") { paused = r.paused; setText(byId("c-pause"), paused ? "Resume" : "Pause"); }
  });
}
