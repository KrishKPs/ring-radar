// Header: 3 KPIs (money stopped, accounts frozen, detect -> freeze), live dot, clock, Nessie pill.

import { byId, money, setText, countTo } from "./util.js";

let connected = false, lastSnapAt = 0;

/** Live dot: green when the event stream is open, grey + "Reconnecting…" when not. */
export function setLive(on) {
  connected = on;
  byId("live-dot").classList.toggle("on", on);
  setText(byId("live-label"), on ? "Live" : "Reconnecting…");
}

// The engine sends a snapshot every tick; none for 2.5s while connected means it is paused.
setInterval(() => {
  if (!connected || !lastSnapAt) return;
  const stalled = Date.now() - lastSnapAt > 2500;
  byId("live-dot").classList.toggle("on", !stalled);
  byId("live-dot").classList.toggle("paused", stalled);
  setText(byId("live-label"), stalled ? "Paused · press Space" : "Live");
}, 500);

/** Update the header from one snapshot. */
export function render(s) {
  lastSnapAt = Date.now();
  const t = s.totals || {}, m = s.metrics || {};
  countTo(byId("kpi-stopped"), t.stopped || 0, money);
  const frozen = byId("kpi-frozen");
  countTo(frozen, t.frozen || 0, (v) => String(Math.round(v)), 400);
  frozen.classList.toggle("danger", (t.frozen || 0) > 0);
  setText(byId("kpi-time"), m.attackToFreezeSec != null ? m.attackToFreezeSec + "s" : "—");
  setText(byId("clock"), s.clock || "--:--:--");
  renderNessie(s.nessie);
}

// "Nessie · 42 records" (balances never change in Nessie, so we show record counts).
function renderNessie(n) {
  const el = byId("nessie-pill");
  if (!n) { el.hidden = true; return; }
  el.hidden = false;
  let txt;
  if (n.settingUp) txt = "Nessie · setting up…";
  else if (!n.live) txt = "Nessie · mock";
  else txt = "Nessie · " + ((n.accounts || 0) + (n.sent || 0)) + " records";
  setText(el, txt);
}
