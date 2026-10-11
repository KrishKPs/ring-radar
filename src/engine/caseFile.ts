// src/engine/caseFile.ts
// Builds the plain-text case file for the fraud team (BUILD_GUIDE 9.8). Assembled
// from the freeze report, what the holder told the agent, and the run timeline.

import type { FreezeReport, HolderFacts } from "../shared/types.js";

const money = (n: number) => "$" + n.toLocaleString("en-US");

export interface CaseData {
  caseId: string;
  seed: number;
  detectedClock: string | null;
  frozenClock: string | null;
  attackToFreezeSec: number | null;
  report: FreezeReport;
  ringNames?: string[];   // display names for the ring accounts (fallback: the ids in the report)
  facts: HolderFacts | null;
  statements: string[];
}

export function buildCaseFile(d: CaseData): string {
  const r = d.report;
  const L: string[] = [];
  const ring = r.ringAccountIds.length;
  const victims = r.victims.length;

  L.push(`RING RADAR - FRAUD CASE ${d.caseId}`);
  L.push(`Run seed ${d.seed}` + (d.frozenClock ? ` - frozen at ${d.frozenClock}` : ""));
  L.push("");

  L.push("SUMMARY");
  L.push(`A mule ring of ${ring} account${ring === 1 ? "" : "s"} took money from ${victims} ` +
    `customer${victims === 1 ? "" : "s"} and passed it on within minutes.`);
  if (d.detectedClock) L.push(`Detected ${d.detectedClock}` + (d.frozenClock ? `, frozen ${d.frozenClock}` : "") +
    (d.attackToFreezeSec != null ? ` (${d.attackToFreezeSec}s from the first scam payment).` : "."));
  L.push(`${money(r.totals.stopped)} stopped, ${money(r.totals.lost)} cashed out, ${money(r.totals.refused)} refused.`);
  L.push("");

  L.push("RING ACCOUNTS (frozen)");
  const ringList = d.ringNames && d.ringNames.length ? d.ringNames : r.ringAccountIds;
  for (const n of ringList) L.push(`  - ${n}`);
  L.push("");

  L.push("VICTIMS");
  for (const v of r.victims) {
    const where = v.status === "lost" ? "cashed out" : v.whereName;
    L.push(`  - ${v.name}: ${money(v.amount)} - ${v.status} (${where}, ${v.hops} hop${v.hops === 1 ? "" : "s"})`);
  }
  L.push("");

  L.push("ACCOUNT HOLDER");
  const f = d.facts;
  L.push(`  Recruiter: ${f?.recruiter ?? "unknown"}`);
  L.push(`  Lure: ${f?.lure ?? "unknown"}`);
  const named = (f?.namedAccounts ?? []).map((n) => `••${n.last4} (${n.result})`).join(", ");
  L.push(`  Named accounts: ${named || "none"}`);
  L.push(`  Intent: ${f?.intent ?? "unclear"}`);
  if (d.statements.length) {
    L.push("  Statements:");
    for (const s of d.statements) L.push(`    "${s}"`);
  }
  L.push("");

  L.push("NEXT STEPS");
  L.push("Freeze confirmed. Funds held in frozen accounts are recoverable. Ready for the fraud team.");
  return L.join("\n");
}
