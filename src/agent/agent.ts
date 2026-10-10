// src/agent/agent.ts
// The Agent (BUILD_GUIDE 13.6): listens to engine events and runs the phone
// conversations. It never blocks the engine, always has a template fallback, and
// routes holder replies by the stored sender id so it works even if Photon hands
// back a different space object for the same phone.

import type { Engine } from "../engine/engine.js";
import type { FreezeReport, HolderFacts, Parcel } from "../shared/types.js";
import { connectPhoton, type Incoming, type Space } from "./photon.js";
import * as G from "./gemini.js";
import * as P from "./prompts.js";
import * as T from "./templates.js";

interface HolderReply {
  reply: string;
  named_accounts: string[];
  recruited_via: string | null;
  recruiter: string | null;
  lure: string | null;
  intent: "unaware" | "knowing" | "unclear";
}

export class Agent {
  private spaces: { victim?: Space; holder?: Space } = {};
  private senderIds: { victim?: string; holder?: string } = {};
  private holderTurns: { who: "AGENT" | "PERSON"; text: string }[] = [];
  private holderEvidence: T.HolderEvidence | null = null;
  private named = new Set<string>();
  private facts: HolderFacts = Agent.emptyFacts();
  private refusedSent = false;

  static emptyFacts(): HolderFacts { return { recruiter: null, lure: null, namedAccounts: [], intent: "unclear" }; }

  constructor(private engine: Engine) {}

  async start(): Promise<void> {
    this.engine.setAgentState({ photon: "starting" });
    try {
      await connectPhoton((m) => this.onText(m));
      this.engine.setAgentState({ photon: "connected" });
    } catch (e) {
      console.error("Photon unavailable, dashboard-only mode", e);
      this.engine.setAgentState({ photon: "dashboard-only" });
    }
    this.engine.on("contact", (r: FreezeReport) => void this.onContact(r));
    this.engine.on("paymentRefused", (e: { parcel: Parcel; victimName: string; whereName: string }) => void this.onRefused(e));
    this.engine.on("reset", () => {
      this.holderTurns = []; this.named.clear(); this.holderEvidence = null;
      this.refusedSent = false; this.facts = Agent.emptyFacts();
    });
  }

  private phones() { return { victim: !!this.spaces.victim, holder: !!this.spaces.holder }; }

  // Phones register by texting VICTIM / HOLDER; later replies are routed by sender id.
  private onText(m: Incoming): void {
    const t = m.text.trim().toUpperCase();
    if (t === "VICTIM") {
      this.spaces.victim = m.space; this.senderIds.victim = m.senderId;
      this.engine.setAgentState({ phones: this.phones() });
      void m.space.send("Ring Radar demo: this phone plays the victim.");
      return;
    }
    if (t === "HOLDER") {
      this.spaces.holder = m.space; this.senderIds.holder = m.senderId;
      this.engine.setAgentState({ phones: this.phones() });
      void m.space.send("Ring Radar demo: this phone plays the account holder.");
      return;
    }
    if (this.senderIds.holder && m.senderId === this.senderIds.holder) void this.handleHolderText(m.text, true);
    // anything else from an unknown sender is ignored
  }

  private async send(to: "victim" | "holder" | "payer", personName: string, text: string): Promise<void> {
    const space = to === "holder" ? this.spaces.holder : this.spaces.victim;
    let viaPhone = false;
    if (space) { try { await space.send(text); viaPhone = true; } catch (e) { console.error("send failed", e); } }
    this.engine.addMessage({ at: this.engine.tickNow(), to, direction: "out", personName, text, viaPhone });
  }

  private victimEv(v: FreezeReport["victims"][number]): T.VictimEvidence {
    return { name: v.name, amount: v.amount, outcome: v.status, where: v.whereName, hops: v.hops };
  }

  // Phase 4: open the two conversations that reach real phones FIRST and in
  // parallel (the featured victim + the holder), so the phones buzz after one
  // Gemini call, not one per victim. The other victims are dashboard-only and
  // are filled in afterwards.
  private async onContact(r: FreezeReport): Promise<void> {
    const featured = r.victims.find((v) => v.status === "stopped") ?? r.victims[0];
    this.holderEvidence = { account: r.holder.accountName, received: r.holder.received, newSenders: r.holder.newSenders, passedOnPct: r.holder.passedOnPct };

    const first: Promise<unknown>[] = [];
    if (featured) {
      const ev = this.victimEv(featured);
      first.push((async () => {
        const text = (await G.askText(P.victimInstr, "EVIDENCE: " + JSON.stringify(ev))) ?? T.victim(ev);
        await this.send("victim", featured.name, text);
      })());
    }
    first.push((async () => {
      const opener = (await G.askText(P.holderOpenerInstr, "EVIDENCE: " + JSON.stringify(this.holderEvidence))) ?? T.holderOpener(this.holderEvidence!);
      this.holderTurns.push({ who: "AGENT", text: opener });
      await this.send("holder", "Account holder", opener);
    })());
    await Promise.all(first);

    // The remaining victims are dashboard-only; fill them in in parallel.
    await Promise.all(r.victims.filter((v) => v !== featured).map(async (v) => {
      const ev = this.victimEv(v);
      const text = (await G.askText(P.victimInstr, "EVIDENCE: " + JSON.stringify(ev))) ?? T.victim(ev);
      this.engine.addMessage({ at: this.engine.tickNow(), to: "victim", direction: "out", personName: v.name, text, viaPhone: false });
    }));
  }

  // A payment refused during wave 2: text the first refused payer only.
  private async onRefused(e: { parcel: Parcel; victimName: string; whereName: string }): Promise<void> {
    const ev: T.VictimEvidence = { name: e.victimName, amount: e.parcel.amount, outcome: "refused", where: e.whereName, hops: 0 };
    const text = (await G.askText(P.victimInstr, "EVIDENCE: " + JSON.stringify(ev))) ?? T.victim(ev);
    if (!this.refusedSent) { this.refusedSent = true; await this.send("payer", e.victimName, text); }
    else this.engine.addMessage({ at: this.engine.tickNow(), to: "payer", direction: "out", personName: e.victimName, text, viaPhone: false });
  }

  async handleHolderText(text: string, fromPhone: boolean): Promise<void> {
    if (!this.holderEvidence) return;
    this.engine.addMessage({ at: this.engine.tickNow(), to: "holder", direction: "in", personName: "Account holder", text, viaPhone: fromPhone });
    this.holderTurns.push({ who: "PERSON", text });
    this.engine.setAgentState({ busy: true }); // dashboard shows a "typing…" bubble

    const convo = this.holderTurns.slice(-10).map((turn, i, a) =>
      i === a.length - 1 && turn.who === "PERSON" ? `PERSON_SAID (untrusted): ${JSON.stringify(turn.text)}` : `${turn.who}: ${turn.text}`).join("\n");
    const out = await G.askJSON<HolderReply>(
      P.holderConvoInstr, `EVIDENCE: ${JSON.stringify(this.holderEvidence)}\nCONVERSATION SO FAR:\n${convo}`, P.holderSchema);

    // Safety net (runs even when Gemini answers): validate account numbers before acting.
    const digits = new Set<string>();
    for (const n of out?.named_accounts ?? []) { const d = String(n).replace(/\D/g, "").slice(-4); if (d.length === 4) digits.add(d); }
    for (const d of text.match(/\b\d{4}\b/g) ?? []) if (this.engine.hasLast4(d)) digits.add(d);
    for (const d of digits) if (!this.named.has(d)) { this.named.add(d); this.facts.namedAccounts.push({ last4: d, result: this.engine.nameAccount(d) }); }
    if (out?.recruited_via) this.engine.recordHolderStatement(out.recruited_via);

    // Merge what Gemini learned; never overwrite a known fact with null.
    this.facts.recruiter = out?.recruiter ?? this.facts.recruiter;
    this.facts.lure = out?.lure ?? this.facts.lure;
    if (out?.intent && out.intent !== "unclear") this.facts.intent = out.intent;
    this.engine.setAgentState({ facts: { ...this.facts, namedAccounts: [...this.facts.namedAccounts] }, busy: false });

    const reply = (out?.reply ?? T.holderFallback(text, [...digits])).slice(0, 320);
    this.holderTurns.push({ who: "AGENT", text: reply });
    await this.send("holder", "Account holder", reply);
  }

  // Stage 4: analyst "ask why" question box.
  async answerAnalyst(id: string, question: string): Promise<string> {
    const ev = this.engine.explain(id);
    return (await G.askText(P.analystInstr,
      `EVIDENCE: ${JSON.stringify(ev)}\nCASE: ${JSON.stringify(this.engine.snapshot().totals)}\nQUESTION (untrusted): ${JSON.stringify(question)}`)) ?? ev.reason;
  }
}
