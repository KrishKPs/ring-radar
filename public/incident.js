// Incident column (Act 2): the iPhone with victim / holder threads, and "What the agent learned".

import { byId, esc, setHTML, setText, post, clockSec, shortName } from "./util.js";

let thread = "holder";
let manualUntil = 0;                      // a manual thread pick wins over auto-switch for 10s
let counts = { victim: 0, holder: 0 };    // messages seen per thread
let unread = { victim: false, holder: false };
let shown = { victim: 0, holder: 0 };     // bubbles already on screen (new ones animate in)

export function init(state) {
  document.querySelectorAll(".thread[data-thread]").forEach((b) => {
    b.onclick = () => { thread = b.dataset.thread; manualUntil = Date.now() + 10000; unread[thread] = false; if (state.snap) render(state.snap); };
  });
  const send = () => {
    const input = byId("fallback-input"), text = input.value.trim();
    if (!text) return;
    input.value = "";
    post("/api/demo/holder", { text });
  };
  byId("fallback-send").onclick = send;
  byId("fallback-input").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") send(); });
}

export function reset() {
  thread = "holder"; manualUntil = 0;
  counts = { victim: 0, holder: 0 }; unread = { victim: false, holder: false }; shown = { victim: 0, holder: 0 };
}

/** Split messages into the two phone threads. The victim thread follows one featured victim. */
function threads(msgs) {
  const firstVictim = msgs.find((m) => m.to === "victim");
  const featured = firstVictim ? firstVictim.personName : null;
  const firstPayer = msgs.find((m) => m.to === "payer");
  return {
    featured,
    victim: msgs.filter((m) => (m.to === "victim" && m.personName === featured) || m === firstPayer),
    holder: msgs.filter((m) => m.to === "holder"),
  };
}

export function render(s) {
  const agent = s.agent || {}, msgs = s.messages || [];
  const t = threads(msgs);

  // Auto-switch to the thread that just got a new message (unless the analyst picked one).
  for (const k of ["victim", "holder"]) {
    if (t[k].length > counts[k]) {
      if (counts[k] > 0 || t[k].length) {
        if (Date.now() > manualUntil) thread = k;
        if (thread !== k) unread[k] = true;
      }
      counts[k] = t[k].length;
    }
  }
  unread[thread] = false;
  document.querySelectorAll(".thread[data-thread]").forEach((b) => {
    const k = b.dataset.thread;
    b.classList.toggle("active", k === thread);
    b.classList.toggle("has-unread", unread[k]);
    setText(b.querySelector(".t-name"), k === "victim" ? "Victim" + (t.featured ? " · " + t.featured : "") : "Holder" + holderTag(s));
  });

  renderPhotonPill(agent);
  renderBubbles(s, t[thread], agent.busy && thread === "holder");
  renderBriefing(s);
  byId("fallback").hidden = agent.photon === "connected";
  setText(byId("phone-time"), (s.clock || "9:41").slice(0, 5));
  setText(byId("phone-caption"), agent.photon === "connected"
    ? "Real iMessages to real phones via Photon."
    : "Photon offline: messages appear here only.");
  renderLearned(s);
}

// "Holder · ••4365": the engine's holder is the first frozen mule (ids M0, M1, ...).
function holderTag(s) {
  const holder = (s.accounts || []).filter((a) => /^M\d/.test(a.id) && a.frozen).sort((a, b) => a.id.localeCompare(b.id))[0];
  return holder ? " · " + shortName(holder) : "";
}

function renderPhotonPill(agent) {
  const el = byId("photon"), p = agent.photon || "starting";
  el.className = "pill-photon " + (p === "connected" ? "on" : p === "dashboard-only" ? "off" : "");
  const ph = agent.phones || {};
  setText(byId("photon-label"), p === "connected" ? "Photon" + (ph.victim || ph.holder ? " · " + [ph.victim && "V", ph.holder && "H"].filter(Boolean).join(" ") : "")
    : p === "dashboard-only" ? "Dashboard only" : "Starting");
}

/* ---------- bubbles: phone owner's view (Ring Radar = grey left, the person = blue right) ---------- */
function renderBubbles(s, msgs, typing) {
  const tickSec = 15, nowSec = clockSec(s.clock), nowTick = s.tick || 0;
  let html = "", lastAt = null;
  const lastMine = msgs.map((m) => m.direction).lastIndexOf("in");
  msgs.forEach((m, i) => {
    // Centered timestamp when more than a simulated minute passed.
    if (nowSec != null && (lastAt == null || m.at - lastAt > 4)) {
      const sec = nowSec - (nowTick - m.at) * tickSec;
      html += '<div class="b-time">' + fmtClock(sec) + "</div>";
    }
    lastAt = m.at;
    const mine = m.direction === "in";
    const isNew = i >= shown[thread];
    const last = i === msgs.length - 1 || msgs[i + 1].direction !== m.direction;
    html += '<div class="bubble ' + (mine ? "mine" : "theirs") + (last ? " tail" : "") + (isNew ? " new" : "") + '">' + esc(m.text) + "</div>";
    if (mine && i === lastMine) html += '<div class="b-note mine">Delivered</div>';
    if (!mine && m.viaPhone === false && last) html += '<div class="b-note">shown on dashboard only</div>';
  });
  if (typing) html += '<div class="bubble theirs typing"><i></i><i></i><i></i></div>';
  const el = byId("bubbles");
  const before = el.innerHTML;
  setHTML(el, html);
  shown[thread] = msgs.length;
  if (el.innerHTML !== before) el.scrollTop = el.scrollHeight;
}

function fmtClock(sec) {
  const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// Play-along note for the judge holding the holder phone, with this run's backup number.
function renderBriefing(s) {
  const el = byId("briefing");
  const show = (s.phase || 0) >= 4 && thread === "holder" && !((s.agent || {}).facts);
  el.hidden = !show;
  if (!show) return;
  const bk = (s.accounts || []).find((a) => a.id === "BK");
  setHTML(el, "<b>Play the holder.</b> A recruiter, <b>Alex</b>, found you on <b>Telegram</b> with a “payment processor” job; you keep 10%." +
    (bk ? " Your backup account is <b class=\"mono\">" + esc(shortName(bk)) + "</b>." : ""));
}

/* ---------- what the agent learned ---------- */
function renderLearned(s) {
  const facts = (s.agent || {}).facts, el = byId("learned-body");
  const card = byId("learned");
  card.classList.toggle("has-facts", !!facts);
  if (!facts) {
    setHTML(el, (s.phase || 0) >= 4
      ? '<div class="waiting">Waiting for the account holder to reply<span class="ellipsis"></span></div>'
      : '<div class="waiting">The agent texts the account holder once the ring is frozen.</div>');
    return;
  }
  const bk = (facts.namedAccounts || [])[0];
  const fields = [
    ["Recruiter", esc(facts.recruiter || "—")],
    ["Lure", esc(facts.lure || "—")],
    ["Backup account", bk ? '<span class="mono">••' + esc(bk.last4) + "</span>" + chip(bk.result) : "—"],
    ["Holder intent", esc(facts.intent || "—")],
  ];
  const rows = fields.map((f, i) => '<div class="lf" style="--i:' + i + '"><span class="lf-k">' + f[0] + '</span><span class="lf-v">' + f[1] + "</span></div>").join("");
  setHTML(el, rows + quote(s, facts));
}

function chip(result) {
  if (result === "frozen" || result === "already-frozen") return ' <span class="outcome danger">FROZEN</span>';
  if (result === "review") return ' <span class="outcome warn">REVIEW</span>';
  return "";
}

// Quote the holder's own words, underlining what Gemini pulled out of them.
function quote(s, facts) {
  const lastIn = (s.messages || []).filter((m) => m.to === "holder" && m.direction === "in").pop();
  if (!lastIn) return "";
  let html = esc(lastIn.text);
  const marks = [];
  for (const n of facts.namedAccounts || []) marks.push([n.last4, "u-danger"]);
  const who = String(facts.recruiter || "").split(/[ ,(]/)[0];
  if (who && who.length > 2) marks.push([who, "u-accent"]);
  for (const [word, cls] of marks) {
    const re = new RegExp("(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i");
    html = html.replace(re, '<span class="' + cls + '">$1</span>');
  }
  return '<div class="quote">“' + html + "”</div>";
}
