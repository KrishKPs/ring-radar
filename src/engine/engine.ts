import { EventEmitter } from "node:events";
import type {
  Account, AgentMessage, AgentState, FeedItem, FreezeReport, LogLine, Parcel, ParcelStatus, Phase, Snapshot, Totals,
  Transfer, TransferKind,
} from "../shared/types.js";
import type { NessieSync } from "../nessie/sync.js";
import { int, mulberry32, pick, type Rng } from "./rng.js";
import { buildWorld, type World } from "./world.js";
import { score } from "./score.js";
import { CANDIDATE_BASE, detectRing } from "./detect.js";
import { explainAccount, type AccountExplanation } from "./explain.js";

const WARMUP_TICKS = 150;
const SPEND_SHOPS = ["S0", "S1", "S3", "S4"];
const PAYROLL = "S2";
// Ticks from detection to each later phase (BUILD_GUIDE 9.7)
const FREEZE_AFTER = 2;
const TRACE_AFTER = 4;
const CONTACT_AFTER = 6;
const CASE_AFTER = 9;
const DOWNSTREAM_RISK = 0.5;
const LONE_BASE = 0.9;
const MANUAL_MAX = 10000;
const NESSIE_EXTRA_PEOPLE = 4;
const BALANCE = { victim: 3000, ring: 0, person: 2500 };

type Edge = Snapshot["edges"][number];
type Scheduled = { due: number; run: () => boolean };

export const money = (n: number) => "$" + n.toLocaleString("en-US");

export interface EngineOptions { seed?: number; nessie: NessieSync; verbose?: boolean }

export class Engine extends EventEmitter {
  seed = 0;
  phase: Phase = 0;
  private nessie: NessieSync;
  private verbose: boolean;
  private rng: Rng = mulberry32(0);
  private tick = 0;
  private paused = false;
  private resetting = false;

  private accounts = new Map<string, Account>();
  private peopleIds: string[] = [];
  private muleIds: string[] = [];
  private plan: World["plan"] = { wave1: [], wave2: [] };

  private events: Scheduled[] = [];
  private transfers: Transfer[] = [];
  private newTransfers: Transfer[] = [];
  private edges = new Map<string, Edge>();
  private feed: FeedItem[] = [];
  private logLines: LogLine[] = [];
  private scored = 0;

  private attackRunning = false;
  private wave: 1 | 2 = 1;
  private wave2: Snapshot["wave2"] = "idle";
  private backupKnownBeforeWave2: boolean | null = null;
  private parcels: Parcel[] = [];
  private ring: string[] = [];
  private detectedAt: number | null = null;
  private launchedAt: number | null = null;
  private firstScamTick: number | null = null;
  private freezeTick: number | null = null;
  private messages: AgentMessage[] = [];
  private holderStatements: string[] = [];
  private phaseClock: (string | null)[] = [null, null, null, null, null, null];
  private agent: AgentState = { photon: "starting", phones: { victim: false, holder: false }, busy: false, facts: null };

  constructor(opts: EngineOptions) {
    super();
    this.nessie = opts.nessie;
    this.verbose = opts.verbose ?? false;
    if (opts.seed !== undefined) this.seed = opts.seed;
  }

  // ---------- run control ----------

  /** Builds a new world, runs the silent warm-up and creates the story accounts in Nessie. */
  async reset(seed?: number): Promise<void> {
    this.resetting = true;
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(this.seed);
    const world = buildWorld(this.rng);

    this.accounts = new Map(world.accounts.map(a => [a.id, a]));
    this.peopleIds = world.peopleIds;
    this.muleIds = world.muleIds;
    this.plan = world.plan;
    this.tick = 0;
    this.events = [];
    this.transfers = [];
    this.edges.clear();
    this.phase = 0;
    this.attackRunning = false;
    this.wave = 1;
    this.wave2 = "idle";
    this.backupKnownBeforeWave2 = null;
    this.parcels = [];
    this.ring = [];
    this.detectedAt = this.launchedAt = this.firstScamTick = this.freezeTick = null;
    this.messages = [];
    this.holderStatements = [];
    this.phaseClock = [null, null, null, null, null, null];
    this.agent = { ...this.agent, busy: false, facts: null };
    this.nessie.clear();

    if (this.verbose) this.logAccounts();

    // Warm-up gives every shop repeat customers, so shops never look like they get many "new" senders
    for (let i = 0; i < WARMUP_TICKS; i++) this.advance();
    this.newTransfers = [];
    this.feed = [];
    this.logLines = [];
    this.scored = 0;

    await this.setupNessie();
    this.log(`Watching ${this.accounts.size} accounts. Seed ${this.seed}.`);
    this.resetting = false;
    this.emit("reset");
    this.emit("snapshot", this.snapshot());
  }

  /** One tick of the live loop. Synchronous: never await a network call here. */
  step(): void {
    if (this.paused || this.resetting) return;
    this.advance();
    if (this.verbose) this.printTick();
    this.emit("snapshot", this.snapshot());
  }

  /** With no argument, toggles. The dashboard Pause button posts `{}`. */
  pause(on?: boolean): boolean {
    this.paused = on === undefined ? !this.paused : on;
    return this.paused;
  }

  launch(): void {
    if (this.attackRunning || this.resetting) return;
    this.attackRunning = true;
    this.wave = 1;
    this.launchedAt = this.tick;
    this.phaseClock[0] = this.clock();
    let d = 2;
    for (const v of this.plan.wave1) {
      const mule = pick(this.rng, this.muleIds);
      this.at(d, () => this.pay(v.id, mule, v.amount));
      d += int(this.rng, 3, 5);
    }
    this.log(`Attack launched: scammers send ${this.plan.wave1.length} victims to ${this.muleIds.length} mule accounts.`, true);
  }

  /** Analyst button: "flagged by mistake". Released accounts score 0 and are skipped by every rule this run. */
  release(id: string): void {
    const a = this.accounts.get(id);
    if (!a || a.released) return;
    a.frozen = false; a.released = true; a.review = false;
    this.log(`Analyst released ${a.name}: flagged by mistake.`, true);
  }

  clearReview(id: string): void {
    const a = this.accounts.get(id);
    if (a) a.review = false;
  }

  /** A payment typed on the dashboard. Refused when either end is frozen. */
  manualPay(from: string, to: string, amount: number): { ok: boolean; message: string } {
    const a = this.accounts.get(from), b = this.accounts.get(to);
    if (!a || !b || from === to) return { ok: false, message: "Pick two different accounts." };
    if (!(amount >= 1 && amount <= MANUAL_MAX)) return { ok: false, message: `Amount must be $1 to ${money(MANUAL_MAX)}.` };
    const t = this.addTransfer(from, to, amount, "manual");
    this.pushFeed(t);
    if (t.blocked) {
      const frozen = a.frozen ? a : b;
      this.log(`${a.name} tried to pay ${money(amount)} to ${b.name}. Refused: ${frozen.name} is frozen.`, true);
      return { ok: false, message: `Refused: ${frozen.name} is frozen.` };
    }
    this.log(`${a.name} paid ${money(amount)} to ${b.name}.`);
    return { ok: true, message: `${a.name} paid ${money(amount)} to ${b.name}.` };
  }

  // ---------- agent hooks ----------

  addMessage(m: AgentMessage): void { this.messages.push(m); }

  setAgentState(p: Partial<AgentState>): void { this.agent = { ...this.agent, ...p }; }

  /** Rule 6: the holder named an account. Only a brand-new account is frozen on one person's word. */
  nameAccount(last4: string): "frozen" | "already-frozen" | "review" | "unknown" {
    const a = [...this.accounts.values()].find(x => x.last4 === last4);
    if (!a) { this.log(`Account holder named ••${last4}: no account has that number.`); return "unknown"; }
    if (a.frozen) return "already-frozen";
    if (a.opened === "new" && !a.released) {
      this.freeze(a.id, "named");
      this.log(`${a.name} frozen: named by the account holder, and it is a brand-new account.`, true);
      return "frozen";
    }
    a.review = true;
    this.log(`${a.name} named by the account holder. It is an established account, so it goes to review, not a freeze.`, true);
    return "review";
  }

  recordHolderStatement(text: string): void {
    this.holderStatements.push(text.slice(0, 300));
    this.log(`Account holder says: ${text.slice(0, 120)}`);
  }

  hasLast4(d: string): boolean { return [...this.accounts.values()].some(a => a.last4 === d); }

  explain(id: string): AccountExplanation {
    const a = this.accounts.get(id);
    if (!a) return { id, name: id, label: "Unknown", risk: 0, base: 0, atFreeze: false, newSenders: 0, passedOnPct: 0,
                     received: 0, age: "Established", reason: "No account has this id in the current run." };
    const paidRing = this.transfers.some(t => t.from === id && this.isRingAccount(t.to));
    return explainAccount(a, x => this.name(x), paidRing);
  }

  // ---------- read helpers (server, agent, eval) ----------

  tickNow(): number { return this.tick; }
  frozenIds(): string[] { return [...this.accounts.values()].filter(a => a.frozen).map(a => a.id); }
  isFrozen(id: string): boolean { return !!this.accounts.get(id)?.frozen; }
  isRingAccount(id: string): boolean { return this.accounts.get(id)?.kind === "acct"; }
  detectTick(): number { return this.detectedAt ?? -1; }
  launchTick(): number { return this.launchedAt ?? -1; }

  /** Ring accounts that actually received scam money this run. */
  ringIds(): string[] {
    const got = new Set(this.transfers.filter(t => !t.blocked && this.isRingAccount(t.to)).map(t => t.to));
    return [...got].sort();
  }

  totals(): Totals {
    const sum = (s: ParcelStatus) => this.parcels.filter(p => p.status === s).reduce((n, p) => n + p.amount, 0);
    return { scored: this.scored, frozen: this.frozenIds().length, stopped: sum("stopped"), lost: sum("lost"), refused: sum("refused") };
  }

  /** Simulated clock: 14:02:00 on tick 150, plus 15 seconds per tick. */
  clock(t = this.tick): string {
    const s = 14 * 3600 + 2 * 60 + (t - WARMUP_TICKS) * 15;
    const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, sec = s % 60;
    return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
  }

  freezeReport(): FreezeReport | null {
    if (this.phase < 2) return null;
    const holder = this.muleIds.filter(id => this.isFrozen(id)).sort()[0] ?? this.ring[0];
    const h = this.accounts.get(holder)!;
    const ev = h.evidenceAtFreeze ?? { ...h.features, base: h.base, tick: this.tick };
    return {
      tick: this.tick,
      ringAccountIds: this.frozenIds().filter(id => this.isRingAccount(id)),
      holder: { accountId: h.id, accountName: h.name, received: ev.received, newSenders: ev.newSenders, passedOnPct: Math.round(ev.passedOn * 100) },
      victims: this.parcels.map(p => ({
        accountId: p.victim, name: this.name(p.victim), amount: p.amount, status: p.status,
        whereName: this.name(p.at), hops: p.path.length - 1,
      })),
      totals: this.totals(),
    };
  }

  snapshot(): Snapshot {
    const ringRisk = this.ring.reduce((m, id) => Math.max(m, this.accounts.get(id)!.risk), 0);
    return {
      tick: this.tick,
      clock: this.clock(),
      phase: this.phase,
      attackRunning: this.attackRunning,
      wave2: this.wave2,
      backupKnownBeforeWave2: this.backupKnownBeforeWave2,
      accounts: [...this.accounts.values()].map(a => ({
        id: a.id, name: a.name, kind: a.kind, x: a.x, y: a.y, base: a.base, risk: a.risk,
        frozen: a.frozen, released: a.released, review: a.review, victim: a.victim, balance: a.balance,
      })),
      edges: [...this.edges.values()],
      newTransfers: this.newTransfers,
      parcels: this.parcels,
      totals: this.totals(),
      log: this.logLines,
      caseFile: null,
      messages: this.messages,
      feed: this.feed,
      phaseClock: this.phaseClock,
      metrics: {
        attackToFreezeSec: this.freezeTick !== null && this.firstScamTick !== null ? (this.freezeTick - this.firstScamTick) * 15 : null,
        ringSize: this.ring.length,
        ringRisk: Math.round(ringRisk * 100) / 100,
      },
      agent: this.agent,
      nessie: this.nessie.status(),
    };
  }

  // ---------- the tick ----------

  private advance(): void {
    this.tick++;
    this.newTransfers = [];

    // 1. scheduled attack events that are due (payments, hops, cash-outs)
    const due = this.events.filter(e => e.due <= this.tick);
    this.events = this.events.filter(e => e.due > this.tick);
    let attackActed = false;
    for (const e of due) if (e.run()) attackActed = true;

    // 2. normal life: one transfer most ticks, a bit less often while the attack is moving money
    if (!attackActed || this.rng() < 0.4) this.normalTransfer();

    // 3. score every account
    const win = score(this.accounts, this.transfers, this.tick);

    // 4. detection and phases
    if (this.attackRunning && this.detectedAt === null) this.tryDetect(win);
    else if (this.detectedAt !== null) this.advancePhases();

    // 5. extra freeze rules
    if (this.phase >= 2) this.joinRule(win);
    this.loneRule(win);

    // 6. feed for the dashboard: this tick's transfers with the receiver's new risk
    for (const t of this.newTransfers) this.pushFeed(t);
  }

  private at(delayTicks: number, run: () => boolean): void {
    this.events.push({ due: this.tick + delayTicks, run });
  }

  // 68% person pays a shop, 20% person pays another person, 12% payroll pays a person
  private normalTransfer(): void {
    const roll = this.rng();
    const person = pick(this.rng, this.peopleIds);
    if (roll < 0.68) {
      this.addTransfer(person, pick(this.rng, SPEND_SHOPS), int(this.rng, 8, 117), "normal");
    } else if (roll < 0.88) {
      let other = pick(this.rng, this.peopleIds);
      while (other === person) other = pick(this.rng, this.peopleIds);
      this.addTransfer(person, other, int(this.rng, 8, 117), "normal");
    } else {
      this.addTransfer(PAYROLL, person, int(this.rng, 300, 799), "normal");
    }
  }

  private addTransfer(from: string, to: string, amount: number, kind: TransferKind): Transfer {
    const a = this.accounts.get(from), b = this.accounts.get(to); // b undefined when to === "OUT"
    const blocked = !!(a?.frozen || b?.frozen);
    const t: Transfer = { tick: this.tick, from, to, amount, kind, blocked };
    this.transfers.push(t);
    this.newTransfers.push(t);
    this.scored++;
    if (to !== "OUT") this.edges.set(`${from}>${to}`, { from, to, lastTick: this.tick, blocked });
    if (!blocked && kind !== "normal") this.nessie.recordTransfer(t);
    return t;
  }

  // ---------- the attack ----------

  private pay(victimId: string, to: string, amount: number): boolean {
    const t = this.addTransfer(victimId, to, amount, "pay");
    if (this.wave === 1 && this.firstScamTick === null) this.firstScamTick = this.tick;
    const p: Parcel = { id: this.parcels.length, victim: victimId, amount, at: to, path: [to],
                        status: t.blocked ? "refused" : "moving", wave: this.wave };
    this.parcels.push(p);
    if (t.blocked) {
      this.log(`${this.name(victimId)} tried to pay ${this.name(to)}. Refused: the account is frozen.`, true);
      if (this.phase >= 4) this.emit("paymentRefused", { parcel: p, victimName: this.name(victimId), whereName: this.name(to) });
    } else {
      this.log(`${this.name(victimId)} paid ${money(amount)} to ${this.name(to)}, an account they have never paid.`);
      this.at(int(this.rng, 3, 6), () => this.hop(p));
    }
    return true;
  }

  // Mule -> COL -> EXIT -> cash-out; BK also cashes out
  private hop(p: Parcel): boolean {
    if (p.status !== "moving") return false;
    const here = this.accounts.get(p.at)!;
    if (here.frozen) return false;                       // freeze() already marked it stopped
    const next = here.role === "mule" ? "COL" : here.role === "collector" ? "EXIT" : "OUT";
    if (next === "OUT") {
      this.addTransfer(p.at, "OUT", p.amount, "cashout");
      p.status = "lost"; p.path.push("OUT");
      this.log(`${money(p.amount)} was cashed out of ${here.name}. It is gone.`, true);
      return true;
    }
    const t = this.addTransfer(p.at, next, p.amount, "hop");
    if (t.blocked) {                                     // Rule 4: tried to pass money into a frozen account
      this.freeze(p.at, "extended", next);
      this.log(`Ring extended: ${here.name} tried to pass money to frozen ${this.name(next)} and was frozen too.`, true);
      return true;
    }
    p.at = next; p.path.push(next);
    this.log(`${here.name} passed ${money(p.amount)} on to ${this.name(next)}.`);
    this.at(next === "EXIT" ? int(this.rng, 4, 7) : int(this.rng, 3, 6), () => this.hop(p));
    return true;
  }

  // ---------- detection, freezing, phases ----------

  private tryDetect(win: Transfer[]): void {
    const ring = detectRing(this.accounts, win);
    if (!ring) return;
    this.ring = ring.sort();
    this.detectedAt = this.tick;
    this.setPhase(1);
    this.log(`RING DETECTED: ${ring.length} accounts passing strangers' money on (${ring.map(id => this.name(id)).join(", ")}).`, true);
    this.emit("ringDetected", { tick: this.tick, accountIds: this.ring });
  }

  private advancePhases(): void {
    const since = this.tick - this.detectedAt!;
    if (this.phase === 1 && since >= FREEZE_AFTER) this.freezeRing();
    if (this.phase === 2 && since >= TRACE_AFTER) {
      this.setPhase(3);
      this.log(`Money traced for ${this.parcels.length} payments.`, true);
    }
    if (this.phase === 3 && since >= CONTACT_AFTER) {
      this.setPhase(4);
      this.log("Contacting the people involved.", true);
      this.emit("contact", this.freezeReport()!);
    }
    if (this.phase === 4 && since >= CASE_AFTER) {
      this.setPhase(5);
      this.log("Case file ready.", true);
    }
  }

  // Rule 3: a suspicious account that sent money into the frozen ring joins it (a mule missed by detection)
  private joinRule(win: Transfer[]): void {
    for (const t of win) {
      const a = this.accounts.get(t.from), b = this.accounts.get(t.to);
      if (!a || !b?.frozen || a.frozen || a.released || a.base < CANDIDATE_BASE) continue;
      this.freeze(a.id, "joined", b.id);
      this.log(`${a.name} joined the frozen ring: it passed strangers' money to ${b.name}.`, true);
    }
  }

  // Rule 5: an account that looks like a mule on its own and cashes out (the backup account in wave 2)
  private loneRule(win: Transfer[]): void {
    for (const t of win) {
      if (t.to !== "OUT") continue;
      const a = this.accounts.get(t.from)!;
      if (a.frozen || a.released || a.base < LONE_BASE) continue;
      this.freeze(a.id, "lone");
      this.log(`${a.name} frozen on its own: strangers' money in, cashed straight out.`, true);
    }
  }

  // Rule 2: freeze the ring, re-score, then freeze accounts the ring fed that now look risky (catches the exit)
  private freezeRing(): void {
    for (const id of this.ring) this.freeze(id, "ring");
    const win = score(this.accounts, this.transfers, this.tick);
    const ringSet = new Set(this.ring);
    const fed = new Set(win.filter(t => ringSet.has(t.from)).map(t => t.to));
    for (const a of this.accounts.values()) {
      if (!a.frozen && !a.released && a.risk >= DOWNSTREAM_RISK && fed.has(a.id)) this.freeze(a.id, "downstream");
    }
    this.freezeTick = this.tick;
    this.setPhase(2);
    this.wave2 = "ready";
    this.log(`FROZEN: ${this.frozenIds().length} accounts. Money inside them can no longer move.`, true);
    this.emit("ringFrozen", this.freezeReport()!);
  }

  private freeze(id: string, because: Account["frozenBecause"], via?: string): void {
    const a = this.accounts.get(id)!;
    if (a.frozen) return;
    a.evidenceAtFreeze = { ...a.features, base: a.base, tick: this.tick };  // keep the evidence as it was
    a.frozen = true; a.released = false; a.frozenBecause = because; a.frozenVia = via;
    for (const p of this.parcels) if (p.status === "moving" && p.at === id) p.status = "stopped";
    this.emit("accountFrozen", { accountId: id, because });
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseClock[p] = this.clock();
    this.emit("phase", p);
  }

  // ---------- Nessie ----------

  // Only the story accounts go to Nessie: victims, ring accounts and a few normal people
  private async setupNessie(): Promise<void> {
    if (!this.nessie.live) return;
    const all = [...this.accounts.values()];
    const story = [
      ...all.filter(a => a.victim).map(a => ({ a, balance: BALANCE.victim })),
      ...all.filter(a => a.kind === "acct").map(a => ({ a, balance: BALANCE.ring })),
      ...all.filter(a => a.kind === "person" && !a.victim).slice(0, NESSIE_EXTRA_PEOPLE).map(a => ({ a, balance: BALANCE.person })),
    ];
    console.log(`Setting up ${story.length} accounts in Nessie...`);
    this.log("Setting up accounts in Nessie...");
    const start = Date.now();
    try {
      const done = this.nessie.createAccounts(
        story.map(({ a, balance }) => {
          const first = a.victim ? a.name : `Acct${a.last4}`;
          return { engineId: a.id, first, nickname: `${first} checking`, balance };
        }));
      this.emit("snapshot", this.snapshot());   // dashboard shows "setting up" while we wait
      await done;
      console.log(`Nessie ready: ${this.nessie.idOf.size} accounts in ${((Date.now() - start) / 1000).toFixed(1)} s`);
    } catch (e) {
      console.error("Nessie setup failed; continuing with the accounts created so far.", e);
    }
    for (const [id, nid] of this.nessie.idOf) this.accounts.get(id)!.nessieAccountId = nid;
  }

  // ---------- small helpers ----------

  private pushFeed(t: Transfer): void {
    const to = this.accounts.get(t.to);
    this.feed.unshift({
      tick: t.tick, clock: this.clock(t.tick),
      fromName: this.name(t.from),
      toName: t.to === "OUT" ? "Cashed out" : this.name(t.to),
      amount: t.amount,
      score: to ? Math.round(to.risk * 100) / 100 : 1,
      blocked: t.blocked,
    });
    this.feed.length = Math.min(this.feed.length, 12);
  }

  private log(text: string, key = false): void {
    this.logLines.unshift({ tick: this.tick, clock: this.clock(), text, key });
    this.logLines.length = Math.min(this.logLines.length, 50);
    if (this.verbose && key) console.log(`  >> ${text}`);
  }

  private name(id: string): string { return this.accounts.get(id)?.name ?? id; }

  // Testing output: this tick's transfers and the top 5 accounts by behaviour score
  private printTick(): void {
    const moves = this.newTransfers.map(t =>
      `${this.name(t.from)} -> ${t.to === "OUT" ? "cash-out" : this.name(t.to)} ${money(t.amount)}${t.kind === "normal" ? "" : ` (${t.kind})`}${t.blocked ? " BLOCKED" : ""}`);
    const top = [...this.accounts.values()].sort((a, b) => b.base - a.base).slice(0, 5)
      .map(a => `${a.id} ${a.base.toFixed(2)}`).join(", ");
    console.log(`[${this.tick} ${this.clock()} p${this.phase}] ${moves.join("; ")} | top: ${top}`);
  }

  private logAccounts(): void {
    const all = [...this.accounts.values()];
    const count = (k: Account["kind"]) => all.filter(a => a.kind === k).length;
    console.log(`World (seed ${this.seed}): ${count("shop")} shops, ${count("person")} people ` +
      `(${all.filter(a => a.victim).length} victims), ${count("acct")} ring accounts, ${this.muleIds.length} mules`);
    console.table(all.map(a => ({ id: a.id, name: a.name, kind: a.kind, role: a.role ?? "", victim: a.victim ? "yes" : "", opened: a.opened, x: a.x, y: a.y })));
    console.log("Victim plan:", JSON.stringify(this.plan));
  }
}
