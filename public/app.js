/* Ring Radar dashboard (BUILD_GUIDE §12). Plain JS, no framework.
   Stage 2: full map (edges, state-coloured nodes, ring halo + card, pulses),
   money trail by name, pause/resume + Nessie chip, and the Ask-why drawer.
   Everything reads from the snapshot streamed over /events. */

"use strict";

let snap = null;
let thread = "holder";        // which phone thread is shown
let paused = false;           // tracked from /api/pause responses
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    .catch((err) => { console.warn("POST " + path + " failed", String(err)); return null; });

/* ---------- controls ---------- */
byId("btn-launch").onclick = () => post("/api/launch");
byId("btn-reset").onclick = () => post("/api/reset");
byId("btn-pause").onclick = () =>
  post("/api/pause").then((r) => { if (r && typeof r.paused === "boolean") { paused = r.paused; byId("btn-pause").textContent = paused ? "Resume" : "Pause"; } });

// Fallback reply box: used only when Photon is offline. Posts to /api/demo/holder.
function sendFallback() {
  const input = byId("fallback-input"), text = input.value.trim();
  if (!text) return;
  input.value = "";
  post("/api/demo/holder", { text });
}
byId("fallback-send").onclick = sendFallback;
byId("fallback-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendFallback(); });

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

/* ---------- Ask-why: node click → GET /api/explain/:id ---------- */
byId("map").addEventListener("click", (e) => {
  const g = e.target.closest("[data-id]");
  if (g) openExplain(g.getAttribute("data-id"));
});
byId("ask-close").onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

/* ---------- helpers ---------- */
function byId(id) { return document.getElementById(id); }
function money(n) { return "$" + Math.round(Number(n) || 0).toLocaleString("en-US"); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function digits4(name) { const m = String(name).match(/(\d{4})\b/); return m ? m[1] : null; }
function labelName(a) { const d = digits4(a.name); return d ? "••" + d : a.name; }

const _last = {};
// Only rewrite innerHTML when the string changed (keeps scroll + selection). §12.4
function setHTML(el, html) { if (_last[el.id] !== html) { _last[el.id] = html; el.innerHTML = html; } }
function setHTML2(id, html) { const el = byId(id); if (_last[id] !== html) { _last[id] = html; el.innerHTML = html; } }
function setText(id, text) { const el = byId(id); if (el && el.textContent !== text) el.textContent = text; }

function setLive(on) { byId("live-dot").classList.toggle("on", on); if (!snap) setText("live-label", on ? "Live" : "Connecting…"); }

// Client-side status for colouring (snapshot accounts don't carry the engine's label).
function clientLabel(a) {
  if (a.frozen) return "frozen";
  if (a.released) return "released";
  if (a.review) return "review";
  if (a.risk >= 0.7) return "suspicious";
  return "normal";
}

/* ---------- narration §12.5 ---------- */
function narrate(s) {
  const p = s.phase || 0;
  if (p === 0) return s.attackRunning
    ? "A scam is running. Victims are paying accounts they have never paid, and those accounts pass the money on within seconds."
    : "A normal day: paychecks, rent, groceries. Every transfer is scored as it happens.";
  return ["",
    "Ring detected from the money pattern alone. Nobody has reported anything.",
    "Every account in the ring is frozen. Money still inside it cannot leave.",
    "Each victim's money has been followed hop by hop.",
    "The agent is texting the people involved. Check the phones.",
    "Case file ready. The scammers still have victims lined up."][p] || "";
}

/* ---------- main render ---------- */
let accById = {};
function render(s) {
  if (!s) return;
  accById = {};
  for (const a of s.accounts || []) accById[a.id] = a;
  setText("live-label", "Live");
  byId("live-dot").classList.add("on");
  setText("clock", s.clock || "--:--:--");
  renderKpis(s); renderAlert(s); renderNessie(s); renderSteps(s); renderFeed(s);
  renderMap(s); pulses(s); renderTrail(s); renderPhone(s); renderBriefing(s); renderFallback(s); renderLearned(s);
}

// Holder play-along note for the judge, shown once the agent starts texting (phase >= 4).
function renderBriefing(s) {
  const el = byId("briefing");
  if ((s.phase || 0) < 4) { el.hidden = true; return; }
  el.hidden = false;
  setHTML(el, "<b>Play the holder.</b> You answered an online ad for a “payment processor” job. A recruiter, <b>Alex</b>, messages you on <b>Telegram</b>; you keep 10%. If asked for a backup account, read the number on your briefing card.");
}

// Fallback reply box: only when Photon is not connected (so a judge can still reply).
function renderFallback(s) {
  const connected = (s.agent || {}).photon === "connected";
  byId("fallback").hidden = connected;
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

function renderNessie(s) {
  const el = byId("nessie-chip"), n = s.nessie;
  el.classList.remove("mock", "setup");
  if (!n) { setHTML(el, ""); return; }
  let txt;
  if (n.settingUp) { txt = "Setting up accounts in Nessie…"; el.classList.add("setup"); }
  else if (!n.live) { txt = "Nessie mock"; el.classList.add("mock"); }
  else { txt = "Nessie · " + (n.accounts || 0) + " accts · " + (n.sent || 0) + " records" + (n.failed ? " · " + n.failed + " failed" : ""); }
  setHTML(el, esc(txt));
}

const STEP_LABELS = ["Ring detected", "accounts frozen", "Money traced", "Texting victims & holder", "Case file for police"];
function renderSteps(s) {
  const phase = s.phase || 0, pc = s.phaseClock || [], t = s.totals || {};
  const labels = [STEP_LABELS[0], (t.frozen || 0) + " " + STEP_LABELS[1], "Money traced, " + (s.parcels || []).length + " victims", STEP_LABELS[3], STEP_LABELS[4]];
  let html = "";
  for (let i = 0; i < 5; i++) {
    const done = phase > i + 1, now = phase === i + 1;
    const cls = done ? "done" : now ? "now" : "future";
    const time = done || now ? (pc[i + 1] || (now ? "now" : "")) : "";
    html += '<li class="' + cls + '"><span class="mark">' + (done ? "✓" : "") + "</span>" + esc(labels[i]) +
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
    else { const sc = f.score || 0, cls = sc >= 0.7 ? "red" : sc >= 0.3 ? "amber" : "green"; chip = '<span class="chip ' + cls + '">' + sc.toFixed(2) + "</span>"; }
    html += '<li class="row"><span class="f-time">' + esc(f.clock || "") + '</span><span class="f-route">' + route +
      '</span><span class="f-amt">' + money(f.amount) + "</span>" + chip + "</li>";
  }
  setHTML(byId("feed"), html);
}

/* ---------- map §12.3 ---------- */
const OUT_POS = { x: 892, y: 286 };
function curve(a, b, off) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  return "M " + a.x + " " + a.y + " Q " + (mx - dy / len * off) + " " + (my + dx / len * off) + " " + b.x + " " + b.y;
}

function renderMap(s) {
  const accts = s.accounts || [], tick = s.tick || 0;
  byId("map-empty").style.display = accts.length ? "none" : "grid";

  // edges (behind nodes)
  let edges = "";
  (s.edges || []).forEach((e, i) => {
    const a = accById[e.from], b = e.to === "OUT" ? OUT_POS : accById[e.to];
    if (!a || !b) return;
    const off = i % 2 ? 28 : -28;
    const ka = accById[e.from], kb = e.to === "OUT" ? null : accById[e.to];
    let stroke = "#2a3d63", w = 1, op = 1, dash = "";
    if (e.blocked) { stroke = "#9b7bff"; w = 1.6; dash = ' stroke-dasharray="4 5"'; }
    else if (ka && ka.kind === "acct" && (e.to === "OUT" || (kb && kb.kind === "acct"))) { stroke = "#ff4d5e"; w = 2.5; }
    else if (kb && kb.kind === "acct") { stroke = "#ff9f43"; w = 2; }
    else { op = clamp(0.18 + 0.6 * (e.lastTick - (tick - 60)) / 60, 0.06, 0.85); }
    edges += '<path d="' + curve(a, b, off) + '" fill="none" stroke="' + stroke + '" stroke-width="' + w + '"' + dash + ' opacity="' + op.toFixed(2) + '"/>';
  });
  setHTML2("g-edges", edges);

  // nodes (clickable) + labels
  const paid = new Set((s.parcels || []).map((p) => p.victim));
  let nodes = "", labels = "";
  for (const a of accts) {
    const x = a.x, y = a.y;
    let shape = "", lab = "";
    if (a.kind === "shop") {
      shape = '<rect x="' + (x - 7) + '" y="' + (y - 7) + '" width="14" height="14" rx="3" fill="#4c8dff"/>';
      lab = label(x, y + 20, a.name);
    } else {
      const st = clientLabel(a);
      if (st === "frozen") {
        shape = '<circle cx="' + x + '" cy="' + y + '" r="11" fill="#ff4d5e"/><circle cx="' + x + '" cy="' + y + '" r="22" fill="none" stroke="#ff4d5e" stroke-width="1.5" stroke-dasharray="4 5"/>';
        lab = label(x, y + 26, labelName(a), true);
      } else if (st === "suspicious") {
        shape = '<circle cx="' + x + '" cy="' + y + '" r="11" fill="#ff4d5e"/>';
        lab = label(x, y + 26, labelName(a), true);
      } else if (st === "released") {
        shape = '<circle cx="' + x + '" cy="' + y + '" r="9" fill="#33d69f"/>';
        lab = label(x, y + 22, labelName(a), true);
      } else if (st === "review") {
        shape = '<circle cx="' + x + '" cy="' + y + '" r="8" fill="#3b5b8f"/><circle cx="' + x + '" cy="' + y + '" r="16" fill="none" stroke="#ffb547" stroke-width="1.5" stroke-dasharray="3 4"/>';
        lab = label(x, y + 22, labelName(a), true);
      } else if (a.victim && paid.has(a.id)) {
        shape = '<circle cx="' + x + '" cy="' + y + '" r="7" fill="#ffb547"/>';
        lab = label(x, y - 12, a.name);
      } else {
        shape = '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="#3b5b8f"/>';
      }
    }
    // transparent hit target makes small nodes easy to click
    nodes += '<g data-id="' + a.id + '" style="cursor:pointer">' + shape +
      '<circle cx="' + x + '" cy="' + y + '" r="15" fill="transparent"/></g>';
    labels += lab;
  }
  setHTML2("g-nodes", nodes);
  if ((s.phase || 0) >= 2) labels += '<text class="node-label" x="889" y="286" text-anchor="end">Cashed out</text>';
  setHTML2("g-labels", labels);

  // halo + dashed outline + ring card
  renderHalo(s, accts);
}
function label(x, y, text, mono) {
  return '<text class="node-label' + (mono ? " mono" : "") + '" x="' + x + '" y="' + y + '" text-anchor="middle">' + esc(text) + "</text>";
}

function renderHalo(s, accts) {
  const card = byId("ring-card");
  if ((s.phase || 0) < 1) { setHTML2("g-halo", ""); card.hidden = true; return; }
  let ring = accts.filter((a) => a.kind === "acct" && (a.frozen || a.risk >= 0.4));
  if (!ring.length) ring = accts.filter((a) => a.kind === "acct");
  if (!ring.length) { setHTML2("g-halo", ""); card.hidden = true; return; }
  const cx = ring.reduce((t, a) => t + a.x, 0) / ring.length;
  const cy = ring.reduce((t, a) => t + a.y, 0) / ring.length;
  setHTML2("g-halo",
    '<circle cx="' + cx.toFixed(0) + '" cy="' + cy.toFixed(0) + '" r="150" fill="url(#halo)"/>' +
    '<circle cx="' + cx.toFixed(0) + '" cy="' + cy.toFixed(0) + '" r="100" fill="none" stroke="#ff4d5e" stroke-width="1.5" stroke-dasharray="7 7" opacity="0.45"/>');

  const m = s.metrics || {};
  const frozen = ring.some((a) => a.frozen);
  const risk = m.ringRisk != null ? m.ringRisk.toFixed(2) : "-";
  card.hidden = false;
  const html = '<div class="rc-title">RING RR-0001 - ' + (frozen ? "FROZEN" : "DETECTED") + "</div>"
    + '<div class="rc-head">' + (m.ringSize || ring.length) + " mule accounts</div>"
    + '<div class="rc-row"><span class="rc-k">Risk</span><span class="rc-v">' + risk + "</span></div>"
    + '<div class="rc-row"><span class="rc-k">Account age</span><span class="rc-v">New</span></div>';
  setHTML(card, html);
}

/* ---------- pulses: a dot along each new transfer's edge §12.3 ---------- */
const SVGNS = "http://www.w3.org/2000/svg";
function pulses(s) {
  if (reducedMotion) return;
  const g = byId("g-pulses");
  for (const t of s.newTransfers || []) {
    const a = accById[t.from], b = t.to === "OUT" ? OUT_POS : accById[t.to];
    if (!a || !b) continue;
    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("r", t.kind === "normal" ? "2.5" : "4");
    dot.setAttribute("fill", t.kind === "normal" ? "#6b82ad" : "#ff4d5e");
    g.appendChild(dot);
    const stopAt = t.blocked ? 0.5 : 1, start = performance.now();
    (function step(now) {
      const p = Math.min((now - start) / 500, 1) * stopAt;
      dot.setAttribute("cx", (a.x + (b.x - a.x) * p).toFixed(1));
      dot.setAttribute("cy", (a.y + (b.y - a.y) * p).toFixed(1));
      if ((now - start) < 500) requestAnimationFrame(step); else dot.remove();
    })(start);
  }
}

/* ---------- money trail strip §12.4 (names, not ids) ---------- */
function renderTrail(s) {
  const parcels = (s.parcels || []).slice(0, 5), totals = s.totals || {};
  setText("trail-summary", (s.parcels || []).length ? money(totals.stopped || 0) + " recovered · " + money(totals.lost || 0) + " lost" : "");
  if (!parcels.length) { setHTML(byId("trail-cards"), '<div class="empty">No victims yet.</div>'); return; }
  const hop = (id) => { if (id === "OUT") return "cashed out"; const a = accById[id]; return a ? labelName(a) : id; };
  const nameOf = (id) => (accById[id] ? accById[id].name : id);
  const pillOf = { stopped: ["frozen", "FROZEN"], lost: ["lost", "CASHED OUT"], refused: ["blocked", "PAYMENT BLOCKED"], moving: ["moving", "MOVING"] };
  let html = "";
  for (const p of parcels) {
    const st = pillOf[p.status] || pillOf.moving;
    html += '<div class="trail-card"><div class="tc-top">' + esc(nameOf(p.victim)) + " · " + money(p.amount) + "</div>" +
      '<div class="tc-path">→ ' + esc((p.path || []).map(hop).join(" → ")) + "</div>" +
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
  const rows = [
    ["Recruiter", facts.recruiter || "—"],
    ["Lure", facts.lure || "—"],
    ["Backup account", bk ? "••" + bk.last4 + " " + bk.result.toUpperCase() : "—"],
    ["Holder intent", facts.intent || "—"],
  ];
  setHTML(byId("learned-body"), rows.map((r) => '<div class="learned-row"><span class="lr-key">' + r[0] + '</span><span class="lr-val">' + esc(r[1]) + "</span></div>").join(""));
}

/* ---------- Ask-why drawer §12.6 ---------- */
let askId = null;
function openExplain(id) {
  askId = id;
  fetch("/api/explain/" + encodeURIComponent(id)).then((r) => r.json()).then(fillDrawer).catch((e) => console.warn("explain failed", String(e)));
}
function fillDrawer(x) {
  if (!x || !x.id) return;
  const cls = String(x.label || "").toLowerCase().replace(/\s+/g, "");
  const release = x.label === "Frozen"
    ? '<button class="btn btn-danger" id="ask-release">Release this account</button>' : "";
  const nums = [
    ["Risk", (x.risk != null ? x.risk.toFixed(2) : "—")],
    ["New senders", x.newSenders],
    ["Passed on", (x.passedOnPct || 0) + "%"],
    ["Received", money(x.received || 0)],
  ];
  setHTML(byId("ask-body"),
    '<div><span class="ask-name">' + esc(x.name) + '</span><span class="ask-pill ' + cls + '">' + esc(x.label) + "</span></div>" +
    '<div class="ask-risk-track"><div class="ask-risk-fill" style="width:' + Math.round((x.risk || 0) * 100) + '%"></div></div>' +
    '<div class="ask-risk-lbl">Risk ' + (x.risk != null ? x.risk.toFixed(2) : "—") + (x.atFreeze ? " · evidence at freeze" : "") + " · " + esc(x.age) + "</div>" +
    '<div class="ask-nums">' + nums.map((n) => '<div class="ask-num"><div class="an-v">' + esc(n[1]) + '</div><div class="an-k">' + n[0] + "</div></div>").join("") + "</div>" +
    '<div class="ask-reason">' + esc(x.reason) + "</div>" + release);
  byId("ask-drawer").hidden = false;
  const rel = byId("ask-release");
  if (rel) rel.onclick = () => post("/api/release", { id: x.id }).then(() => openExplain(x.id));
}
function closeDrawer() { byId("ask-drawer").hidden = true; askId = null; }
