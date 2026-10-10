/* Ring Radar dashboard (BUILD_GUIDE §12). Plain JS, no framework.
   Stage 1: dark layout + map nodes (dots) from the live snapshot.
   Everything reads from the snapshot and shows an empty state until the engine sends data. */

"use strict";

let snap = null;
let thread = "holder"; // which phone thread is shown

/* ---------- data in ---------- */
const es = new EventSource("/events");
es.onmessage = (e) => {
  try { snap = JSON.parse(e.data); render(snap); }
  catch (err) { console.error("bad snapshot", err); }
};
es.onopen = () => setLive(true);
es.onerror = () => setLive(false);

const post = (path, body = {}) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch((err) => console.warn("POST " + path + " failed", String(err)));

/* ---------- controls ---------- */
byId("btn-launch").onclick = () => post("/api/launch");
byId("btn-reset").onclick = () => post("/api/reset");
byId("btn-pause").onclick = () => post("/api/pause");
document.querySelectorAll(".pill[data-thread]").forEach((b) => {
  b.onclick = () => {
    thread = b.dataset.thread;
    document.querySelectorAll(".pill[data-thread]").forEach((x) => x.classList.toggle("active", x === b));
    if (snap) renderPhone(snap);
  };
});
document.querySelectorAll(".tab[data-tab]").forEach((t) => {
  t.onclick = () => document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
});

/* ---------- helpers ---------- */
function byId(id) { return document.getElementById(id); }
function money(n) { return "$" + Math.round(Number(n) || 0).toLocaleString("en-US"); }
const _last = {};
// Only rewrite innerHTML when the string changed (keeps scroll + selection). §12.4
function setHTML(el, html) { if (_last[el.id] !== html) { _last[el.id] = html; el.innerHTML = html; } }
function setText(id, text) { const el = byId(id); if (el && el.textContent !== text) el.textContent = text; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function last4(name) { const m = String(name).match(/(\d{4})\s*$/); return m ? m[1] : name; }

function setLive(on) {
  byId("live-dot").classList.toggle("on", on);
  if (!snap) setText("live-label", on ? "Live" : "Connecting…");
}

/* ---------- narration §12.5 ---------- */
function narrate(s) {
  const p = s.phase || 0;
  if (p === 0) return s.attackRunning
    ? "A scam is running. Victims are paying accounts they have never paid, and those accounts pass the money on within seconds."
    : "A normal day: paychecks, rent, groceries. Every transfer is scored as it happens.";
  return [
    "",
    "Ring detected from the money pattern alone. Nobody has reported anything.",
    "Every account in the ring is frozen. Money still inside it cannot leave.",
    "Each victim's money has been followed hop by hop.",
    "The agent is texting the people involved. Check the phones.",
    "Case file ready. The scammers still have victims lined up.",
  ][p] || "";
}

const STEP_LABELS = ["Ring detected", "accounts frozen", "Money traced", "Texting victims & holder", "Case file for police"];

/* ---------- main render ---------- */
function render(s) {
  if (!s) return;
  setText("live-label", "Live");
  byId("live-dot").classList.add("on");
  setText("clock", s.clock || "--:--:--");
  renderKpis(s);
  renderAlert(s);
  renderSteps(s);
  renderFeed(s);
  renderMap(s);
  renderTrail(s);
  renderPhone(s);
  renderLearned(s);
}

function renderKpis(s) {
  const t = s.totals || {}, m = s.metrics || {};
  setText("kpi-scored", (t.scored || 0).toLocaleString("en-US"));
  const ringEl = byId("kpi-ring");
  ringEl.textContent = s.phase >= 1 ? "1" : "0";
  ringEl.classList.toggle("alert", s.phase >= 1);
  setText("kpi-frozen", String(t.frozen || 0));
  setText("kpi-stopped", money(t.stopped || 0));
  setText("kpi-lost", money(t.lost || 0));
  setText("kpi-time", m.attackToFreezeSec != null ? m.attackToFreezeSec + "s" : "—");
}

function renderAlert(s) {
  const card = byId("alert-card");
  const ring = (s.phase || 0) >= 1;
  card.classList.toggle("ring", ring);
  setText("alert-status", ring ? "● RING DETECTED · RR-0001" : "WATCHING");
  const nAcct = (s.accounts || []).length;
  setText("alert-title", ring ? "Mule ring caught mid-attack" : (nAcct ? "Watching " + nAcct + " accounts. No ring." : "Watching the network"));
  setText("alert-sub", narrate(s));
  const segs = byId("alert-progress").children;
  for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("done", ring && (s.phase || 0) >= i + 1);
}

function renderSteps(s) {
  const phase = s.phase || 0, pc = s.phaseClock || [], t = s.totals || {};
  const frozen = t.frozen || 0, victims = (s.parcels || []).length;
  const labels = [STEP_LABELS[0], frozen + " " + STEP_LABELS[1], "Money traced, " + victims + " victims", STEP_LABELS[3], STEP_LABELS[4]];
  let html = "";
  for (let i = 0; i < 5; i++) {
    const done = phase > i + 1, now = phase === i + 1;
    const cls = done ? "done" : now ? "now" : "future";
    const mark = done ? "✓" : "";
    const time = done || now ? (pc[i + 1] || (now ? "now" : "")) : "";
    html += '<li class="' + cls + '"><span class="mark">' + mark + '</span>' + esc(labels[i]) +
      '<span class="step-time">' + esc(time) + "</span></li>";
  }
  setHTML(byId("steps"), html);
}

function renderFeed(s) {
  const feed = s.feed || [];
  if (!feed.length) { setHTML(byId("feed"), '<li class="empty">Waiting for transfers…</li>'); return; }
  let html = "";
  for (const f of feed) {
    const route = esc(f.fromName) + " → " + esc(f.toName);
    let chip;
    if (f.blocked) chip = '<span class="chip block">BLOCK</span>';
    else {
      const sc = f.score || 0, cls = sc >= 0.7 ? "red" : sc >= 0.3 ? "amber" : "green";
      chip = '<span class="chip ' + cls + '">' + sc.toFixed(2) + "</span>";
    }
    html += '<li class="row"><span class="f-time">' + esc(f.clock || "") + '</span>' +
      '<span class="f-route">' + route + '</span>' +
      '<span class="f-amt">' + money(f.amount) + "</span>" + chip + "</li>";
  }
  setHTML(byId("feed"), html);
}

/* ---------- map: Stage 1 draws nodes (dots) + labels §12.3 ---------- */
function renderMap(s) {
  const accts = s.accounts || [];
  byId("map-empty").style.display = accts.length ? "none" : "grid";
  let nodes = "", labels = "";
  for (const a of accts) {
    const x = a.x, y = a.y;
    if (a.kind === "shop") {
      nodes += '<rect x="' + (x - 7) + '" y="' + (y - 7) + '" width="14" height="14" rx="3" fill="#4c8dff"/>';
      labels += label(x, y + 20, a.name);
    } else if (a.kind === "acct") {
      const frozen = a.frozen;
      nodes += '<circle cx="' + x + '" cy="' + y + '" r="11" fill="#ff4d5e"/>';
      if (frozen) nodes += '<circle cx="' + x + '" cy="' + y + '" r="22" fill="none" stroke="#ff4d5e" stroke-width="1.5" stroke-dasharray="4 5"/>';
      labels += label(x, y + 26, "••" + last4(a.name), true);
    } else if (a.victim) {
      nodes += '<circle cx="' + x + '" cy="' + y + '" r="7" fill="#ffb547"/>';
      labels += label(x, y - 12, a.name);
    } else {
      nodes += '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="#3b5b8f"/>';
    }
  }
  setHTML2("g-nodes", nodes);
  setHTML2("g-labels", labels);
}
function label(x, y, text, mono) {
  return '<text class="node-label' + (mono ? " mono" : "") + '" x="' + x + '" y="' + y + '" text-anchor="middle">' + esc(text) + "</text>";
}
// SVG groups need their own cache since they have ids too
function setHTML2(id, html) { const el = byId(id); if (_last[id] !== html) { _last[id] = html; el.innerHTML = html; } }

function renderTrail(s) {
  const parcels = (s.parcels || []).slice(0, 5);
  const totals = s.totals || {};
  setText("trail-summary", parcels.length ? money(totals.stopped || 0) + " recovered · " + money(totals.lost || 0) + " lost" : "");
  if (!parcels.length) { setHTML(byId("trail-cards"), '<div class="empty">No victims yet.</div>'); return; }
  let html = "";
  for (const p of parcels) {
    const path = (p.path || []).map((id) => (id === "OUT" ? "cashed out" : "••" + last4(id))).join(" → ");
    const map = { stopped: ["frozen", "FROZEN"], lost: ["lost", "CASHED OUT"], refused: ["blocked", "PAYMENT BLOCKED"], moving: ["moving", "MOVING"] };
    const st = map[p.status] || map.moving;
    html += '<div class="trail-card"><div class="tc-top">' + esc(p.victim) + " · " + money(p.amount) + '</div>' +
      '<div class="tc-path">→ ' + esc(path) + '</div>' +
      '<span class="pill-status ' + st[0] + '">' + st[1] + "</span></div>";
  }
  setHTML(byId("trail-cards"), html);
}

/* ---------- phone / agent §12.4 ---------- */
function renderPhone(s) {
  const agent = s.agent || {}, photon = agent.photon || "starting";
  const pe = byId("photon");
  pe.classList.toggle("on", photon === "connected");
  pe.classList.toggle("degraded", photon === "dashboard-only");
  setText("photon-label", photon === "connected" ? "Photon" : photon === "dashboard-only" ? "Dashboard only" : "Starting");
  const ph = agent.phones || {};
  setText("phone-status", "Victim phone " + (ph.victim ? "✓" : "—") + " · Holder phone " + (ph.holder ? "✓" : "—"));

  const all = s.messages || [];
  const want = thread === "holder" ? (m) => m.to === "holder" : (m) => m.to === "victim" || m.to === "payer";
  const msgs = all.filter(want).slice(-8);
  if (!msgs.length && !agent.busy) { setHTML(byId("bubbles"), '<div class="empty">No messages yet.</div>'); return; }
  let html = "";
  for (const m of msgs) {
    const side = m.direction === "in" ? "in" : "out";
    html += '<div class="bubble ' + side + '">' + esc(m.text) + "</div>";
    if (m.viaPhone === false) html += '<div class="bubble-tag ' + side + '">dashboard only</div>';
  }
  if (agent.busy) html += '<div class="typing">Ring Radar is typing…</div>';
  setHTML(byId("bubbles"), html);
  const b = byId("bubbles"); b.scrollTop = b.scrollHeight;
}

function renderLearned(s) {
  const facts = (s.agent || {}).facts;
  if (!facts) { byId("learned-body").className = "learned-empty"; setHTML(byId("learned-body"), "Waiting for the account holder to reply."); return; }
  byId("learned-body").className = "";
  const bk = (facts.namedAccounts || [])[0];
  const bkTxt = bk ? "••" + bk.last4 + " " + bk.result.toUpperCase() : "—";
  const rows = [
    ["Recruiter", facts.recruiter || "—"],
    ["Lure", facts.lure || "—"],
    ["Backup account", bkTxt],
    ["Holder intent", facts.intent || "—"],
  ];
  setHTML(byId("learned-body"), rows.map((r) =>
    '<div class="learned-row"><span class="lr-key">' + r[0] + '</span><span class="lr-val">' + esc(r[1]) + "</span></div>").join(""));
}
