// Bottom ticker: newest transfer on the left, max 25 items, pauses while hovered.

import { byId, esc, money } from "./util.js";

const MAX = 25;
let track, seen = new Set(), hovering = false, queue = [];

export function init() {
  track = byId("tk-track");
  track.addEventListener("mouseenter", () => { hovering = true; });
  track.addEventListener("mouseleave", () => { hovering = false; flush(); });
}

export function reset() { seen = new Set(); queue = []; track.replaceChildren(); }

export function render(s) {
  // s.feed is newest first; walk oldest -> newest so the newest ends up leftmost.
  const fresh = [];
  for (const f of (s.feed || []).slice().reverse()) {
    const key = f.tick + "|" + f.fromName + "|" + f.toName + "|" + f.amount;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(f);
  }
  if (seen.size > 400) seen = new Set([...seen].slice(-200));
  queue.push(...fresh);
  if (!hovering) flush();
}

function flush() {
  for (const f of queue) track.prepend(item(f));
  queue = [];
  while (track.children.length > MAX) track.lastElementChild.remove();
}

function item(f) {
  const el = document.createElement("div");
  const score = Math.round((f.score || 0) * 100);
  const hot = f.blocked || score >= 75, warm = !hot && score >= 40;
  el.className = "tk-item" + (hot ? " hot" : warm ? " warm" : "");
  const pill = f.blocked ? "REFUSED" : String(score);
  el.innerHTML = '<span class="tk-time mono">' + esc(f.clock || "") + "</span>" +
    '<span class="tk-names">' + esc(f.fromName) + " → " + esc(f.toName) + "</span>" +
    '<span class="tk-amt mono">' + money(f.amount) + "</span>" +
    '<span class="tk-pill mono">' + pill + "</span>";
  return el;
}
