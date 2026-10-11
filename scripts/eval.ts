// Accuracy evaluation: many seeds, no timers, Nessie off. Usage: npm run eval -- 100
import { writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { Engine } from "../src/engine/engine.js";
import { NessieSync } from "../src/nessie/sync.js";

config.nessie.mode = "mock";

const N = Number(process.argv[2] ?? 100);
const FIRST_SEED = 1000;     // held out: thresholds were never tuned on these seeds
const CALM_TICKS = 30;
const MAX_TICKS = 400;
const SETTLE_TICKS = 40;     // after phase 5, let in-flight money finish moving
const NO_ATTACK_TICKS = 300;

const median = (a: number[]) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] ?? 0; };

interface Row {
  seed: number; detected: boolean; ticksToDetect: number; caught: number; ringSize: number;
  innocent: number; falseBefore: number; stopped: number; lost: number;
}

const rows: Row[] = [];
for (let seed = FIRST_SEED; seed < FIRST_SEED + N; seed++) {
  const e = new Engine({ seed, nessie: new NessieSync() });
  await e.reset(seed);
  for (let i = 0; i < CALM_TICKS; i++) e.step();
  const falseBefore = e.frozenIds().length;
  e.launch();
  let ticks = 0;
  while (e.phase < 5 && ticks++ < MAX_TICKS) e.step();
  for (let i = 0; i < SETTLE_TICKS; i++) e.step();
  const ring = e.ringIds();
  const t = e.totals();
  rows.push({
    seed,
    detected: e.phase >= 1,
    ticksToDetect: e.detectTick() - e.launchTick(),
    caught: ring.filter(id => e.isFrozen(id)).length,
    ringSize: ring.length,
    innocent: e.frozenIds().filter(id => !e.isRingAccount(id)).length,
    falseBefore,
    stopped: t.stopped,
    lost: t.lost,
  });
}

// False-alarm test: same seeds, no attack at all
let noAttackFrozen = 0;
for (let seed = FIRST_SEED; seed < FIRST_SEED + N; seed++) {
  const e = new Engine({ seed, nessie: new NessieSync() });
  await e.reset(seed);
  for (let i = 0; i < NO_ATTACK_TICKS; i++) e.step();
  noAttackFrozen += e.frozenIds().length;
}

const sum = (k: keyof Row) => rows.reduce((a, r) => a + Number(r[k]), 0);
const detected = rows.filter(r => r.detected);
console.table({
  runs: N,
  seeds: `${FIRST_SEED}..${FIRST_SEED + N - 1}`,
  detectionRate: (detected.length / N * 100).toFixed(1) + "%",
  ringAccountsCaught: (sum("caught") / sum("ringSize") * 100).toFixed(1) + "%",
  innocentAccountsFrozen: sum("innocent") + sum("falseBefore"),
  noAttackAccountsFrozen: noAttackFrozen,
  medianMinutesToDetect: (median(detected.map(r => r.ticksToDetect)) * 15 / 60).toFixed(1),
  moneyStoppedShare: (sum("stopped") / (sum("stopped") + sum("lost")) * 100).toFixed(1) + "%",
});

const missed = rows.filter(r => !r.detected).map(r => r.seed);
const innocentSeeds = rows.filter(r => r.innocent + r.falseBefore > 0).map(r => r.seed);
if (missed.length) console.log("Not detected on seeds:", missed.join(", "));
if (innocentSeeds.length) console.log("Innocent freezes on seeds:", innocentSeeds.join(", "));

// Write a small summary the dashboard can show on its "tested on N attacks" panel.
writeFileSync("public/eval.json", JSON.stringify({
  runs: N,
  detectionRate: (detected.length / N * 100).toFixed(1) + "%",
  ringAccountsCaught: (sum("caught") / sum("ringSize") * 100).toFixed(1) + "%",
  innocentFrozen: sum("innocent") + sum("falseBefore") + noAttackFrozen,
  moneyStoppedShare: (sum("stopped") / (sum("stopped") + sum("lost")) * 100).toFixed(1) + "%",
  generatedAt: new Date().toISOString().slice(0, 10),
}, null, 2));
console.log("Wrote public/eval.json");
