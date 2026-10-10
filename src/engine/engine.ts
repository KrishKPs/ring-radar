import { EventEmitter } from "node:events";
import type {
  Account, AgentMessage, AgentState, FeedItem, LogLine, Parcel, Phase, Snapshot, Totals, Transfer, TransferKind,
} from "../shared/types.js";
import { int, mulberry32, pick, type Rng } from "./rng.js";
import { buildWorld, type World } from "./world.js";

const WARMUP_TICKS = 150;
const SPEND_SHOPS = ["S0", "S1", "S3", "S4"];
const PAYROLL = "S2";
// Stage 1 testing: print every transfer the live loop makes
const LOG_TRANSFERS = true;

type Edge = Snapshot["edges"][number];

export const money = (n: number) => "$" + n.toLocaleString("en-US");

const emptyTotals = (): Totals => ({ scored: 0, frozen: 0, stopped: 0, lost: 0, refused: 0 });

export class Engine extends EventEmitter {
  seed = 0;
  private rng: Rng = mulberry32(0);
  private tick = 0;
  private paused = false;

  private accounts = new Map<string, Account>();
  private peopleIds: string[] = [];
  private muleIds: string[] = [];
  private plan: World["plan"] = { wave1: [], wave2: [] };

  private transfers: Transfer[] = [];
  private newTransfers: Transfer[] = [];
  private edges = new Map<string, Edge>();
  private feed: FeedItem[] = [];
  private logLines: LogLine[] = [];
  private totalsNow: Totals = emptyTotals();

  private phase: Phase = 0;
  private attackRunning = false;
  private wave2: Snapshot["wave2"] = "idle";
  private backupKnownBeforeWave2: boolean | null = null;
  private parcels: Parcel[] = [];
  private messages: AgentMessage[] = [];
  private phaseClock: (string | null)[] = [null, null, null, null, null, null];
  private agent: AgentState = { photon: "starting", phones: { victim: false, holder: false }, busy: false, facts: null };

  constructor(opts: { seed?: number } = {}) {
    super();
    if (opts.seed !== undefined) this.seed = opts.seed;
  }

  /** Builds a new world and runs the silent warm-up. */
  async reset(seed?: number): Promise<void> {
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(this.seed);
    const world = buildWorld(this.rng);

    this.accounts = new Map(world.accounts.map(a => [a.id, a]));
    this.peopleIds = world.peopleIds;
    this.muleIds = world.muleIds;
    this.plan = world.plan;
    this.tick = 0;
    this.transfers = [];
    this.edges.clear();
    this.phase = 0;
    this.attackRunning = false;
    this.wave2 = "idle";
    this.backupKnownBeforeWave2 = null;
    this.parcels = [];
    this.messages = [];
    this.phaseClock = [null, null, null, null, null, null];
    this.agent = { ...this.agent, busy: false, facts: null };

    this.logAccounts();

    // Warm-up gives every shop repeat customers, so shops never look like they get many "new" senders
    for (let i = 0; i < WARMUP_TICKS; i++) this.advance();
    this.newTransfers = [];
    this.feed = [];
    this.logLines = [];
    this.totalsNow = emptyTotals();

    this.log(`Watching ${this.accounts.size} accounts. Seed ${this.seed}.`);
    this.emit("reset");
  }

  /** One tick of the live loop. Synchronous: never await a network call here. */
  step(): void {
    if (this.paused) return;
    this.advance();
    if (LOG_TRANSFERS) for (const t of this.newTransfers) console.log(`[tick ${t.tick} ${this.clock(t.tick)}] ${this.describe(t)}`);
    this.emit("snapshot", this.snapshot());
  }

  pause(on: boolean): void { this.paused = on; }

  tickNow(): number { return this.tick; }

  /** Simulated clock: 14:02:00 on tick 150, plus 15 seconds per tick. */
  clock(t = this.tick): string {
    const s = 14 * 3600 + 2 * 60 + (t - WARMUP_TICKS) * 15;
    const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, sec = s % 60;
    return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
  }

  snapshot(): Snapshot {
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
      totals: { ...this.totalsNow },
      log: this.logLines,
      caseFile: null,
      messages: this.messages,
      feed: this.feed,
      phaseClock: this.phaseClock,
      metrics: { attackToFreezeSec: null, ringSize: 0, ringRisk: 0 },
      agent: this.agent,
    };
  }

  private advance(): void {
    this.tick++;
    this.newTransfers = [];
    this.normalTransfer();
    for (const t of this.newTransfers) this.pushFeed(t);
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
    this.totalsNow.scored++;
    if (to !== "OUT") this.edges.set(`${from}>${to}`, { from, to, lastTick: this.tick, blocked });
    return t;
  }

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
  }

  private name(id: string): string { return this.accounts.get(id)?.name ?? id; }

  private describe(t: Transfer): string {
    return `${this.name(t.from)} -> ${t.to === "OUT" ? "cash-out" : this.name(t.to)} ${money(t.amount)} (${t.kind})`;
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
