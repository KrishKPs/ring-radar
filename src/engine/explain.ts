import type { Account } from "../shared/types.js";
import { CANDIDATE_BASE } from "./detect.js";

/** What GET /api/explain/:id returns (BUILD_GUIDE 12.6). */
export interface AccountExplanation {
  id: string; name: string; label: string;
  risk: number; base: number; atFreeze: boolean;
  newSenders: number; passedOnPct: number; received: number; age: "New" | "Established";
  reason: string;
}

const money = (n: number) => "$" + n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The status label used on the map and in pills. */
export function label(a: Account): string {
  if (a.frozen) return "Frozen";
  if (a.released) return "Released";
  if (a.review) return "Under review";
  if (a.base >= CANDIDATE_BASE || a.risk >= 0.7) return "Suspicious";
  if (a.risk >= 0.3) return "Exposed";
  return "Normal";
}

/** Builds the explanation. Frozen accounts are explained from the evidence kept at freeze time. */
export function explainAccount(a: Account, nameOf: (id: string) => string, paidRing: boolean): AccountExplanation {
  const ev = a.frozen && a.evidenceAtFreeze ? a.evidenceAtFreeze : { ...a.features, base: a.base };
  const pct = Math.round(ev.passedOn * 100);
  const n = ev.newSenders, x = money(ev.received);
  const via = a.frozenVia ? nameOf(a.frozenVia) : "a frozen account";

  let reason: string;
  if (a.frozen) {
    switch (a.frozenBecause) {
      case "joined": reason = `Received ${x} from ${plural(n, "new sender")} and passed ${pct}% of it to ${via}, which is part of the frozen ring.`; break;
      case "extended": reason = `Received ${x} from a new sender, then tried to pass it straight to ${via}, which was already frozen.`; break;
      case "lone": reason = `Received ${x} from ${plural(n, "new sender")} and cashed ${pct}% straight out. No other accounts were involved.`; break;
      case "named": reason = "Named by the account holder as another account they were told to use. It is newly opened, so it was frozen on that report."; break;
      default: reason = `Received ${x} from ${plural(n, "sender")} who had never paid it before, and passed on ${pct}% of it within a few steps.` +
        `${a.opened === "new" ? " The account is newly opened." : ""} It is connected to other accounts that behave the same way.`;
    }
  } else if (a.released) {
    reason = "An analyst marked this account as flagged by mistake. It is released and treated as normal for the rest of the run.";
  } else if (a.review) {
    reason = "Named by the account holder, but this is an established account with a normal history. One person's word is not enough to freeze it.";
  } else if (a.kind === "shop") {
    reason = "Many people pay this account, but they are repeat customers and the money stays here. That is a shop, not a mule.";
  } else if (paidRing) {
    reason = "Sent money to an account that is now flagged. This looks like a victim, so the account stays open and the person is contacted.";
  } else if (label(a) === "Suspicious") {
    reason = `Received ${x} from ${plural(n, "new sender")} and passed on ${pct}% of it. Watching it, not frozen yet.`;
  } else {
    reason = "Nothing unusual: an established account that keeps the money it receives.";
  }

  return {
    id: a.id, name: a.name, label: label(a),
    risk: Math.round(a.risk * 100) / 100, base: Math.round(ev.base * 100) / 100, atFreeze: a.frozen && !!a.evidenceAtFreeze,
    newSenders: n, passedOnPct: pct, received: ev.received, age: a.opened === "new" ? "New" : "Established",
    reason,
  };
}
