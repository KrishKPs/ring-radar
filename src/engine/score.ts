import type { Account, Features, Transfer } from "../shared/types.js";

export const W = 60, MATCH_TICKS = 12, PENDING_TICKS = 12, MATCH_LOW = 0.8, MATCH_HIGH = 1.25, ROUNDS = 3, ALPHA = 0.5;

const push = <V>(m: Map<string, V[]>, k: string, v: V) => { (m.get(k) ?? m.set(k, []).get(k)!).push(v); };

/** Scores every account in place (features, base, risk) and returns the window's unblocked transfers. */
export function score(accounts: Map<string, Account>, transfers: Transfer[], tick: number): Transfer[] {
  const t0 = tick - W;
  const win: Transfer[] = [];
  // Sender -> receiver pairs seen before the window: those senders are not "new"
  const oldPairs = new Set<string>();
  for (const x of transfers) {
    if (x.tick > t0) { if (!x.blocked) win.push(x); }
    else oldPairs.add(x.from + ">" + x.to);
  }

  const ins = new Map<string, Transfer[]>(), outs = new Map<string, Transfer[]>(), nb = new Map<string, [string, number][]>();
  for (const x of win) {
    push(ins, x.to, x); push(outs, x.from, x);
    if (x.to !== "OUT") { push(nb, x.from, [x.to, x.amount]); push(nb, x.to, [x.from, x.amount]); }
  }

  for (const a of accounts.values()) {
    const I = ins.get(a.id) ?? [], O = (outs.get(a.id) ?? []).slice();
    const senders = new Set<string>();
    let received = 0, matched = 0, counted = 0;
    for (const x of I) {
      received += x.amount;
      if (!oldPairs.has(x.from + ">" + a.id)) senders.add(x.from);
      // Passed on = a similar amount left within MATCH_TICKS; each outgoing transfer matches only once
      const k = O.findIndex(o => o.tick > x.tick && o.tick <= x.tick + MATCH_TICKS &&
                                 o.amount >= MATCH_LOW * x.amount && o.amount <= MATCH_HIGH * x.amount);
      if (k >= 0) { matched += x.amount; counted += x.amount; O.splice(k, 1); }
      else if (tick - x.tick >= PENDING_TICKS) counted += x.amount;
    }
    const f: Features = {
      newSenders: senders.size,
      passedOn: counted ? matched / counted : 0,
      received,
      young: a.opened === "new" ? 1 : 0,
    };
    const nw = Math.min(1, f.newSenders / 3);
    a.features = f;
    a.base = Math.min(1, 0.5 * f.passedOn * nw + 0.25 * f.passedOn * f.young + 0.25 * f.young * nw);
  }

  // Risk spreading: each round, move halfway toward the amount-weighted risk of neighbours, never below own base
  let r = new Map<string, number>();
  for (const a of accounts.values()) r.set(a.id, a.released ? 0 : a.frozen ? 1 : a.base);
  for (let k = 0; k < ROUNDS; k++) {
    const q = new Map<string, number>();
    for (const a of accounts.values()) {
      if (a.released) { q.set(a.id, 0); continue; }
      if (a.frozen) { q.set(a.id, 1); continue; }
      let w = 0, s = 0;
      for (const [b, amt] of nb.get(a.id) ?? []) { w += amt; s += amt * (r.get(b) ?? 0); }
      q.set(a.id, Math.max(a.base, (1 - ALPHA) * a.base + ALPHA * (w ? s / w : 0)));
    }
    r = q;
  }
  for (const a of accounts.values()) a.risk = r.get(a.id)!;
  return win;
}
