import type { Account, Transfer } from "../shared/types.js";

export const CANDIDATE_BASE = 0.45;
const MIN_RING_SIZE = 3;
const MIN_OUTSIDE_SENDERS = 3;

/** Rule 1: suspicious accounts joined by window transfers form a ring if big enough and fed by enough outsiders. */
export function detectRing(accounts: Map<string, Account>, win: Transfer[]): string[] | null {
  const cand = [...accounts.values()].filter(a => !a.frozen && !a.released && a.base >= CANDIDATE_BASE).map(a => a.id);
  // Union-find: parent points toward each group's root
  const parent = new Map(cand.map(c => [c, c]));
  const find = (x: string): string => parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!);
  for (const t of win) if (parent.has(t.from) && parent.has(t.to)) parent.set(find(t.from), find(t.to));

  const groups = new Map<string, string[]>();
  for (const c of cand) { const g = find(c); (groups.get(g) ?? groups.set(g, []).get(g)!).push(c); }
  for (const g of groups.values()) {
    if (g.length < MIN_RING_SIZE) continue;
    const outside = new Set(win.filter(t => g.includes(t.to) && !g.includes(t.from)).map(t => t.from));
    if (outside.size >= MIN_OUTSIDE_SENDERS) return g;
  }
  return null;
}
