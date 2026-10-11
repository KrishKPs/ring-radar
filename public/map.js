// Map: payment network in SVG (900 x 560 box from the engine). Nodes are keyed and reused
// every tick; only nodes whose look changes are rebuilt, so one-time animations (freeze pulse)
// play once. Act 2 adds the ring hull, a gentle zoom, and dims everything not involved.

import { byId, esc, money, shortName, setHTML, post, reducedMotion } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const VB = { x: 0, y: 0, w: 900, h: 560 };
const OUT_POS = { x: 880, y: 300 };
const EDGE_MAX = 40, EDGE_AGE = 60;    // 60 ticks of 15 sim-seconds = 15 sim-minutes

let svg, gNodes, gEdges, gPulses, gHull, gTags, hullPath, hullLabel;
let nodes = new Map();      // id -> { g, look }
let seen = new Set();       // legend entries that have appeared this run
let zoomed = false, vb = { ...VB }, vbAnim = 0;
let stateRef = null;

export function init(state) {
  stateRef = state;
  svg = byId("map"); gNodes = byId("g-nodes"); gEdges = byId("g-edges");
  gPulses = byId("g-pulses"); gHull = byId("g-hull"); gTags = byId("g-tags");
  // Click a node: explain it. Click empty space: close the explanation.
  svg.addEventListener("click", (e) => {
    const g = e.target.closest("[data-id]");
    if (g) openExplain(g.dataset.id); else closeExplain();
  });
}

export function reset() {
  nodes.forEach((n) => n.g.remove()); nodes.clear();
  seen = new Set(); zoomed = false; setViewBox({ ...VB });
  gHull.replaceChildren(); hullPath = hullLabel = null;
  gTags.replaceChildren(); gPulses.replaceChildren();
  document.querySelectorAll("#legend .lg[data-k]").forEach((l) => { l.hidden = !["normal", "shop"].includes(l.dataset.k); });
  closeExplain(); showView("network");
}

export function onPhase(p) {
  svg.classList.toggle("focus", p === "incident" || p === "resolved");
  byId("seg-trail").disabled = !(p === "incident" || p === "resolved");
}

export function render(s, state) {
  const acc = {};
  for (const a of s.accounts || []) acc[a.id] = a;
  const involved = involvedIds(s, acc);
  renderEdges(s, acc, involved);
  renderNodes(s, acc, involved);
  renderHull(s, acc);
  renderTags(s, acc);
  pulses(s, acc);
  if (state.view === "trail") renderTrail(s, acc);
}

/* ---------- who is part of the incident ---------- */
function involvedIds(s, acc) {
  const ids = new Set();
  if ((s.phase || 0) < 1) return ids;
  for (const a of s.accounts || []) if (a.kind === "acct" && (a.frozen || a.risk >= 0.4)) ids.add(a.id);
  for (const p of s.parcels || []) { ids.add(p.victim); (p.path || []).forEach((id) => ids.add(id)); }
  return ids;
}

/* ---------- node look: one key per visual state ---------- */
function lookOf(a, paidVictims, s) {
  if (a.kind === "shop") return "shop";
  if (a.frozen) return a.id === "BK" ? "frozen-bk" : "frozen";
  if (a.released) return "released";
  if (a.review) return "review";
  // Victims pick up risk from the ring too; they stay victims, never "suspicious".
  if (a.victim && paidVictims.has(a.id)) return "victim";
  if (a.kind === "acct" && a.risk >= 0.75) return "ring";
  if (a.risk >= 0.4) return "suspicious";
  return "normal";
}

const LOCK = (x, y) => '<path class="lock" d="M' + (x - 3.5) + " " + (y - 0.5) + "h7v5.5h-7z M" + (x - 2) + " " + (y - 0.5) +
  "v-2a2 2 0 0 1 4 0v2" + '"/>';

function shapeFor(look, a) {
  const x = a.x, y = a.y;
  switch (look) {
    case "shop": return '<rect class="n-shop" x="' + (x - 7) + '" y="' + (y - 7) + '" width="14" height="14" rx="3"/>' +
      '<text class="n-lbl" x="' + x + '" y="' + (y + 22) + '">' + esc(a.name) + "</text>";
    case "frozen": case "frozen-bk": return '<circle class="n-frozen-ring' + (look === "frozen-bk" ? " bk" : "") + '" cx="' + x + '" cy="' + y + '" r="16"/>' +
      '<circle class="n-ring" cx="' + x + '" cy="' + y + '" r="10" filter="url(#glow)"/>' + LOCK(x, y) +
      '<text class="n-lbl mono hot" x="' + x + '" y="' + (y + 30) + '">' + esc(shortName(a)) + "</text>";
    case "ring": return '<circle class="n-ring" cx="' + x + '" cy="' + y + '" r="8" filter="url(#glow)"/>' +
      '<text class="n-lbl mono hot" x="' + x + '" y="' + (y + 24) + '">' + esc(shortName(a)) + "</text>";
    case "suspicious": return '<circle class="n-warn-halo" cx="' + x + '" cy="' + y + '" r="14"/><circle class="n-warn" cx="' + x + '" cy="' + y + '" r="7"/>' +
      '<text class="n-lbl mono" x="' + x + '" y="' + (y + 24) + '">' + esc(shortName(a)) + "</text>";
    case "victim": return '<circle class="n-victim" cx="' + x + '" cy="' + y + '" r="7"/>' +
      '<text class="n-lbl" x="' + x + '" y="' + (y - 13) + '">' + esc(a.name) + "</text>";
    case "released": return '<circle class="n-safe" cx="' + x + '" cy="' + y + '" r="8"/>' +
      '<text class="n-lbl mono" x="' + x + '" y="' + (y + 22) + '">' + esc(shortName(a)) + " · released</text>";
    case "review": return '<circle class="n-normal" cx="' + x + '" cy="' + y + '" r="6"/><circle class="n-review" cx="' + x + '" cy="' + y + '" r="13"/>' +
      '<text class="n-lbl mono" x="' + x + '" y="' + (y + 26) + '">' + esc(shortName(a)) + " · review</text>";
    default: return '<circle class="n-normal" cx="' + x + '" cy="' + y + '" r="4"/>';
  }
}

function renderNodes(s, acc, involved) {
  const paid = new Set((s.parcels || []).map((p) => p.victim));
  const focus = involved.size > 0;
  let stagger = 0;
  for (const a of s.accounts || []) {
    let n = nodes.get(a.id);
    if (!n) {
      const g = document.createElementNS(NS, "g");
      g.dataset.id = a.id;
      g.setAttribute("class", "node");
      // Transparent hit target so small dots are easy to click.
      n = { g, look: "" };
      nodes.set(a.id, n);
      gNodes.appendChild(g);
    }
    const look = lookOf(a, paid, s);
    if (look !== n.look) {
      const wasFrozen = n.look.startsWith("frozen");
      n.g.innerHTML = shapeFor(look, a) + '<circle class="hit" cx="' + a.x + '" cy="' + a.y + '" r="15"/>';
      // One-time scale pulse when a node is first frozen, staggered 80ms per node.
      if (look.startsWith("frozen") && !wasFrozen && !reducedMotion) {
        n.g.style.setProperty("--d", (stagger++ * 80) + "ms");
        n.g.classList.remove("pulse"); void n.g.getBBox(); n.g.classList.add("pulse");
      }
      n.look = look;
      markLegend(look);
    }
    n.g.classList.toggle("dim", focus && !involved.has(a.id) && a.kind !== "shop");
    n.g.classList.toggle("dim-shop", focus && a.kind === "shop");
  }
  // OUT marker (where cashed-out money goes) once a ring is caught.
  let out = nodes.get("OUT");
  if ((s.phase || 0) >= 1 && !out) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "node out");
    g.innerHTML = '<circle class="n-out" cx="' + OUT_POS.x + '" cy="' + OUT_POS.y + '" r="6"/>' +
      '<text class="n-lbl end" x="' + (OUT_POS.x + 8) + '" y="' + (OUT_POS.y - 14) + '">Cashed out</text>';
    nodes.set("OUT", { g, look: "out" });
    gNodes.appendChild(g);
  }
}

function markLegend(look) {
  const k = look.startsWith("frozen") || look === "ring" ? "frozen" : look;
  if (seen.has(k)) return;
  seen.add(k);
  const el = document.querySelector('#legend .lg[data-k="' + k + '"]');
  if (el) el.hidden = false;
}

/* ---------- edges: most recent 120, fading with age ---------- */
function curve(a, b, off) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  return "M" + a.x + " " + a.y + "Q" + (mx - dy / len * off).toFixed(1) + " " + (my + dx / len * off).toFixed(1) + " " + b.x + " " + b.y;
}

function renderEdges(s, acc, involved) {
  const tick = s.tick || 0, focus = involved.size > 0;
  // Scam edges (anything touching a ring account or a cash-out) are always drawn;
  // only the background payments are capped, newest first.
  const isScam = (e) => e.to === "OUT" || acc[e.from]?.kind === "acct" || acc[e.to]?.kind === "acct";
  const all = s.edges || [];
  const edges = all.filter(isScam).concat(
    all.filter((e) => !isScam(e) && tick - e.lastTick <= EDGE_AGE).sort((a, b) => b.lastTick - a.lastTick).slice(0, EDGE_MAX));
  let html = "";
  edges.forEach((e, i) => {
    const a = acc[e.from], b = e.to === "OUT" ? OUT_POS : acc[e.to];
    if (!a || !b) return;
    const fromRing = a.kind === "acct", toRing = e.to === "OUT" || b.kind === "acct";
    let cls = "e-normal", op = 0.35 * Math.max(0.15, 1 - (tick - e.lastTick) / EDGE_AGE);
    if (e.blocked) { cls = "e-blocked"; op = 0.8; }
    else if (fromRing && toRing) { cls = "e-scam"; op = 0.9; }
    else if (toRing) { cls = "e-pay"; op = 0.85; }
    const dim = focus && !(involved.has(e.from) && (e.to === "OUT" || involved.has(e.to)));
    html += '<path class="' + cls + (dim ? " dim" : "") + '" d="' + curve(a, b, i % 2 ? 24 : -24) + '" opacity="' + op.toFixed(2) + '"/>';
  });
  setHTML(gEdges, html);
}

/* ---------- ring hull: padded, rounded convex hull around ring members ---------- */
function hullPoints(members, pad) {
  // Sample a circle of radius `pad` around each member, then take the convex hull.
  const pts = [];
  for (const m of members) for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    pts.push([m.x + Math.cos(t) * pad, m.y + Math.sin(t) * pad]);
  }
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function smoothPath(pts) {
  // Quadratic curves through edge midpoints give rounded corners.
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = "M" + mid(pts[pts.length - 1], pts[0]).map((v) => v.toFixed(1)).join(" ");
  for (let i = 0; i < pts.length; i++) {
    const m = mid(pts[i], pts[(i + 1) % pts.length]);
    d += "Q" + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1) + " " + m[0].toFixed(1) + " " + m[1].toFixed(1);
  }
  return d + "Z";
}

function renderHull(s, acc) {
  const members = (s.accounts || []).filter((a) => a.kind === "acct" && (a.frozen || (a.id !== "BK" && a.risk >= 0.4)));
  if ((s.phase || 0) < 1 || !members.length) { if (hullPath) { gHull.replaceChildren(); hullPath = hullLabel = null; } return; }
  const pts = hullPoints(members, 30);
  const d = smoothPath(pts);
  if (!hullPath) {
    hullPath = document.createElementNS(NS, "path");
    hullPath.setAttribute("class", "hull" + (reducedMotion ? "" : " draw"));
    hullLabel = document.createElementNS(NS, "text");
    hullLabel.setAttribute("class", "hull-lbl mono");
    gHull.append(hullPath, hullLabel);
  }
  hullPath.setAttribute("d", d);
  const minY = Math.min(...pts.map((p) => p[1])), minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  hullLabel.setAttribute("x", ((minX + maxX) / 2).toFixed(0));
  hullLabel.setAttribute("y", Math.max(16, minY - 10).toFixed(0));
  const involvedUsd = (s.parcels || []).reduce((t, p) => t + p.amount, 0);
  const refused = (s.parcels || []).filter((p) => p.status === "refused").length;
  hullLabel.textContent = "RING RR-0001 · " + members.length + " accounts · " + money(involvedUsd) + (refused ? " · " + refused + " refused" : "");
  if (!zoomed) { zoomed = true; zoomTo(pts); }
}

/* ---------- gentle zoom toward the ring ---------- */
function zoomTo(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = VB.w * 0.85, h = VB.h * 0.85;
  // Move 15% of the way toward the hull centre, staying inside the map box.
  const x = Math.max(0, Math.min(VB.w - w, cx - w / 2)), y = Math.max(0, Math.min(VB.h - h, cy - h / 2));
  animateViewBox({ x, y, w, h });
}

export function resetZoom() { zoomed = true; animateViewBox({ ...VB }); }

function animateViewBox(to) {
  cancelAnimationFrame(vbAnim);
  if (reducedMotion) { setViewBox(to); return; }
  const from = { ...vb }, start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / 800, 1), e = 1 - Math.pow(1 - t, 3);
    setViewBox({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
    if (t < 1) vbAnim = requestAnimationFrame(step);
  };
  vbAnim = requestAnimationFrame(step);
}
function setViewBox(v) { vb = v; svg.setAttribute("viewBox", [v.x, v.y, v.w, v.h].map((n) => n.toFixed(1)).join(" ")); }

/* ---------- tags: the backup account the holder named ---------- */
function renderTags(s, acc) {
  const bk = acc.BK, facts = (s.agent || {}).facts;
  const named = bk && facts && (facts.namedAccounts || []).some((n) => bk.name.endsWith(n.last4) && n.result === "frozen");
  let html = "";
  if (bk && bk.frozen) {
    html = '<text class="tag fade-in" x="' + bk.x + '" y="' + (bk.y + 48) + '">' +
      (named ? "BACKUP · FROZEN BEFORE USE" : "BACKUP · CAUGHT BY PATTERN") + "</text>";
  }
  setHTML(gTags, html);
}

/* ---------- transfer dots ---------- */
function pulses(s, acc) {
  if (reducedMotion) return;
  for (const t of s.newTransfers || []) {
    const a = acc[t.from], b = t.to === "OUT" ? OUT_POS : acc[t.to];
    if (!a || !b) continue;
    const risk = t.to === "OUT" ? 1 : (b.risk || 0);
    const cls = t.blocked || risk >= 0.75 ? "p-scam" : risk >= 0.4 ? "p-warn" : "p-normal";
    // Keep the screen calm: only suspicious or scam money moves on the map.
    if (cls === "p-normal" && t.kind === "normal") continue;
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("r", cls === "p-normal" ? "2.5" : "3.5");
    dot.setAttribute("class", cls);
    gPulses.appendChild(dot);
    // Refused payments stop halfway and show a small burst.
    const stopAt = t.blocked ? 0.5 : 1, start = performance.now(), dur = 700;
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1) * stopAt;
      dot.setAttribute("cx", (a.x + (b.x - a.x) * p).toFixed(1));
      dot.setAttribute("cy", (a.y + (b.y - a.y) * p).toFixed(1));
      if (now - start < dur) requestAnimationFrame(step);
      else { dot.remove(); if (t.blocked) burst(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5); }
    };
    requestAnimationFrame(step);
  }
}

function burst(x, y) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("class", "refused-burst mono");
  t.setAttribute("x", x.toFixed(0)); t.setAttribute("y", (y - 8).toFixed(0));
  t.textContent = "✕ REFUSED";
  gPulses.appendChild(t);
  setTimeout(() => t.remove(), 1400);
}

/* ---------- Money trail view (replaces the graph in place) ---------- */
export function showView(v) {
  document.querySelectorAll("#seg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  byId("trail-view").hidden = v !== "trail";
  svg.classList.toggle("hidden-view", v === "trail");
  if (v === "trail" && stateRef?.snap) {
    const acc = {}; for (const a of stateRef.snap.accounts || []) acc[a.id] = a;
    renderTrail(stateRef.snap, acc);
  }
}

const OUTCOME = { stopped: ["safe", "STOPPED"], lost: ["danger", "CASHED OUT"], refused: ["warn", "REFUSED"], moving: ["dim", "MOVING"] };
function renderTrail(s, acc) {
  const parcels = s.parcels || [];
  const hop = (id) => (id === "OUT" ? "cash out" : acc[id] ? shortName(acc[id]) : id);
  const rows = parcels.map((p) => {
    const o = OUTCOME[p.status] || OUTCOME.moving;
    const chips = (p.path || []).filter((id) => id !== "OUT").map((id) => '<span class="hop mono">' + esc(hop(id)) + "</span>").join('<span class="arrow">→</span>');
    return '<div class="trow"><span class="t-victim">' + esc(acc[p.victim]?.name || p.victim) + '</span><span class="t-amt mono">' + money(p.amount) + "</span>" +
      '<span class="t-hops">' + chips + '</span><span class="outcome ' + o[0] + '">' + o[1] + "</span>" +
      '<span class="t-wave mono">wave ' + (p.wave || 1) + "</span></div>";
  }).join("");
  setHTML(byId("trail-view"), '<div class="panel-title">Money trail · every victim payment</div>' + rows);
}

/* ---------- explain popover (click a node): GET /api/explain/:id ---------- */
function openExplain(id) {
  fetch("/api/explain/" + encodeURIComponent(id)).then((r) => r.json()).then(fillExplain)
    .catch((e) => console.warn("explain failed", String(e)));
}
export function closeExplain() { byId("explain").hidden = true; }

function fillExplain(x) {
  if (!x || !x.id) return;
  const el = byId("explain");
  const tone = x.label === "Frozen" ? "danger" : x.label === "Released" ? "safe" : (x.risk || 0) >= 0.4 ? "warn" : "dim";
  el.innerHTML =
    '<button class="icon-btn x-close" aria-label="Close">×</button>' +
    '<div class="x-head"><span class="x-name">' + esc(x.name) + '</span><span class="outcome ' + tone + '">' + esc(x.label) + "</span></div>" +
    '<div class="x-meta mono">risk ' + (x.risk != null ? Math.round(x.risk * 100) : "—") + " · " + esc(x.age) + (x.atFreeze ? " · evidence at freeze" : "") + "</div>" +
    '<div class="x-nums mono"><span><b>' + esc(x.newSenders) + "</b> new senders</span><span><b>" + esc(x.passedOnPct || 0) + "%</b> passed on</span><span><b>" + money(x.received) + "</b> received</span></div>" +
    '<div class="x-reason">' + esc(x.reason) + "</div>" +
    (x.label === "Frozen" ? '<button class="btn btn-ghost" id="x-release">Release this account</button>' : "") +
    '<div class="x-ask"><input id="x-q" type="text" placeholder="Ask why… (Gemini)" /><button class="btn" id="x-go">Ask</button></div>' +
    '<div class="x-answer" id="x-answer"></div>';
  el.hidden = false;
  el.querySelector(".x-close").onclick = closeExplain;
  const rel = byId("x-release");
  if (rel) rel.onclick = () => post("/api/release", { id: x.id }).then(() => openExplain(x.id));
  const go = byId("x-go"), q = byId("x-q");
  go.onclick = async () => {
    const question = q.value.trim(); if (!question) return;
    byId("x-answer").textContent = "Thinking…";
    const res = await post("/api/ask", { id: x.id, question });
    byId("x-answer").textContent = (res && res.answer) || "(no answer)";
  };
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") go.onclick(); e.stopPropagation(); });
}
