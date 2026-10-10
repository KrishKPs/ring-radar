import type { Account, AccountKind, RingRole } from "../shared/types.js";
import { LAYOUT_SEED, int, mulberry32, shuffle, type Rng } from "./rng.js";

const SHOPS = [
  { id: "S0", name: "Campus Grocery", x: 150, y: 110 },
  { id: "S1", name: "Rent & Co", x: 330, y: 480 },
  { id: "S2", name: "State U Payroll", x: 110, y: 410 },
  { id: "S3", name: "Transit Pass", x: 385, y: 80 },
  { id: "S4", name: "Corner Cafe", x: 255, y: 285 },
];

const VICTIM_NAMES = ["Maya", "Jordan", "Priya", "Sam", "Elena", "Marcus", "Aisha", "Tom", "Nia", "Leo", "Hana", "Omar"];
const PEOPLE = 40;
const VICTIM_POOL = 16;
const MIN_GAP = 46;
const MAX_TRIES = 6000;

export interface VictimPlan { id: string; amount: number }

export interface World {
  accounts: Account[];
  peopleIds: string[];
  muleIds: string[];
  plan: { wave1: VictimPlan[]; wave2: VictimPlan[] };
}

function newAccount(id: string, name: string, kind: AccountKind, x: number, y: number, extra: Partial<Account> = {}): Account {
  const young = kind === "acct" ? 1 : 0;
  return {
    id, name, kind, x, y,
    opened: kind === "acct" ? "new" : "established",
    base: 0, risk: 0,
    features: { newSenders: 0, passedOn: 0, received: 0, young },
    frozen: false, released: false, review: false,
    ...extra,
  };
}

// Random points in the left area, rejecting any closer than MIN_GAP to a shop or another person
function placePeople(r: Rng): Array<{ x: number; y: number }> {
  const taken = SHOPS.map(s => ({ x: s.x, y: s.y }));
  const placed: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < MAX_TRIES && placed.length < PEOPLE; i++) {
    const p = { x: Math.round(40 + r() * 480), y: Math.round(40 + r() * 480) };
    if (taken.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= MIN_GAP)) { placed.push(p); taken.push(p); }
  }
  if (placed.length < PEOPLE) throw new Error(`world: placed only ${placed.length} of ${PEOPLE} people`);
  return placed;
}

function uniqueLast4(r: Rng, used: Set<string>): string {
  let d: string;
  do d = String(int(r, 1000, 9999)); while (used.has(d));
  used.add(d);
  return d;
}

function ringAccounts(r: Rng, used: Set<string>): Account[] {
  const m = int(r, 2, 4);
  const ring: Array<{ id: string; role: RingRole; x: number; y: number }> = [];
  for (let i = 0; i < m; i++) {
    ring.push({ id: `M${i}`, role: "mule", x: 600 + (i % 2 === 0 ? -12 : 12), y: Math.round(300 + (i - (m - 1) / 2) * 70) });
  }
  ring.push({ id: "COL", role: "collector", x: 716, y: 300 });
  ring.push({ id: "EXIT", role: "exit", x: 815, y: 300 });
  ring.push({ id: "BK", role: "backup", x: 790, y: 120 });
  return ring.map(a => {
    const last4 = uniqueLast4(r, used);
    return newAccount(a.id, `Acct ••${last4}`, "acct", a.x, a.y, { role: a.role, last4 });
  });
}

/** Builds a fresh world. The map layout is fixed; everything else comes from the run's generator. */
export function buildWorld(runRng: Rng): World {
  const layoutRng = mulberry32(LAYOUT_SEED);
  const used = new Set<string>();

  const shops = SHOPS.map(s => newAccount(s.id, s.name, "shop", s.x, s.y));
  const people = placePeople(layoutRng).map((p, i) => newAccount(`P${i}`, "", "person", p.x, p.y));

  // The right-most people have the shortest lines to the ring, so victims come from them
  const pool = people.slice().sort((a, b) => b.x - a.x).slice(0, VICTIM_POOL);
  const victims = shuffle(runRng, pool).slice(0, int(runRng, 7, 9));
  const names = shuffle(runRng, VICTIM_NAMES);
  victims.forEach((v, i) => { v.victim = true; v.name = names[i]; });

  for (const p of people) {
    p.last4 = uniqueLast4(runRng, used);
    if (!p.victim) p.name = `Acct ••${p.last4}`;
  }

  const ring = ringAccounts(runRng, used);
  const plan = victims.map(v => ({ id: v.id, amount: 200 + 50 * int(runRng, 0, 20) }));

  return {
    accounts: [...shops, ...people, ...ring],
    peopleIds: people.map(p => p.id),
    muleIds: ring.filter(a => a.role === "mule").map(a => a.id),
    plan: { wave1: plan.slice(0, plan.length - 3), wave2: plan.slice(plan.length - 3) },
  };
}
