// src/agent/templates.ts
// Fallback messages used whenever Gemini returns null. The demo must never wait
// on, or break because of, Gemini (AGENTS.md agent invariants). Plain text only:
// at most 320 chars, no markdown, no emoji, never asks for secrets.

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

export interface VictimEvidence { name: string; amount: number; outcome: string; where: string; hops: number; }
export interface HolderEvidence { account: string; received: number; newSenders: number; passedOnPct: number; }

export function victim(ev: VictimEvidence): string {
  if (ev.outcome === "stopped")
    return `Ring Radar: we stopped your ${money(ev.amount)} payment. It reached ${ev.where} and is frozen there, so it never left the scam ring. Your bank can return it.`;
  if (ev.outcome === "lost")
    return `Ring Radar: your ${money(ev.amount)} payment was cashed out before we caught the account. We traced it through ${ev.hops} accounts and attached the trail to your claim.`;
  // refused
  return `Ring Radar: your ${money(ev.amount)} payment to ${ev.where} was not sent. We froze that account because it is part of a scam. Your money is still in your account.`;
}

export function holderOpener(ev: HolderEvidence): string {
  const acct = String(ev.account).replace(/^Acct\s*/, "");
  return `Ring Radar: your account ${acct} received ${money(ev.received)} from ${ev.newSenders} people you don't normally deal with and passed it on within minutes. It's frozen while we review it. Who asked you to move this money?`;
}

export function holderFallback(text: string, digits: string[]): string {
  if (digits.length)
    return `Thank you. I've passed ••${digits[0]} to our fraud team. An investigator will contact you about what happens next.`;
  if (/job|ad|telegram|instagram|recruit|offer|%/i.test(text))
    return "Thanks for telling us. Offers like that are how scam rings recruit people. Did they give you any other account number to send money to?";
  return "Understood. Did someone offer you a job or a fee to receive money and pass it on?";
}
