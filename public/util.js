// Small DOM and formatting helpers shared by every dashboard module.

export const byId = (id) => document.getElementById(id);
export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "$1,234" */
export function money(n) { return "$" + Math.round(Number(n) || 0).toLocaleString("en-US"); }

/** Escape text for innerHTML. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** "Acct ••1234" -> "••1234"; people and shops keep their name. */
export function shortName(a) {
  const m = String(a?.name ?? "").match(/(\d{4})\b/);
  return m ? "••" + m[1] : (a?.name ?? "");
}

// Only rewrite innerHTML when the HTML string changed (keeps scroll and selection).
const lastHtml = new WeakMap();
export function setHTML(el, html) {
  if (el && lastHtml.get(el) !== html) { lastHtml.set(el, html); el.innerHTML = html; }
}
export function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

// An account is "acting strangely" once its risk passes 0.4 (40) and it is not frozen.
export function suspiciousAccounts(s) {
  return (s.accounts || []).filter((a) => a.kind !== "shop" && !a.victim && !a.frozen && !a.released && a.risk >= 0.4);
}

/** "14:07:30" -> seconds since midnight (simulated clock). */
export function clockSec(c) {
  const p = String(c || "").split(":").map(Number);
  return p.length === 3 && p.every((n) => !isNaN(n)) ? p[0] * 3600 + p[1] * 60 + p[2] : null;
}

/** POST JSON, never throws; returns parsed body or null. */
export function post(path, body = {}) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch((err) => { console.warn("POST " + path + " failed", String(err)); return null; });
}

/** Animate a number in an element from its last value to `to` over ms. */
const counters = new WeakMap();
export function countTo(el, to, fmt, ms = 600) {
  const prev = counters.get(el);
  const from = prev ? prev.value : 0;
  if (prev && prev.target === to) return;
  if (prev && prev.raf) cancelAnimationFrame(prev.raf);
  if (reducedMotion || from === to) { counters.set(el, { value: to, target: to }); setText(el, fmt(to)); return; }
  const start = performance.now(), state = { value: from, target: to, raf: 0 };
  counters.set(el, state);
  const step = (now) => {
    const t = Math.min((now - start) / ms, 1), e = 1 - Math.pow(1 - t, 3);
    state.value = from + (to - from) * e;
    setText(el, fmt(t === 1 ? to : state.value));
    if (t < 1) state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
}

/** Show a short toast in the bottom-right corner. */
export function toast(text, kind = "safe") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = text;
  byId("toasts").appendChild(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3100);
}
