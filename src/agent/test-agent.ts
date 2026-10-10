// src/agent/test-agent.ts
// Stage 3 standalone test: wires an Agent to a fresh Engine (no server, no index.ts),
// launches an attack, and checks the agent produced victim + holder messages, then
// feeds a holder reply to check fact extraction + nameAccount.
//
// Fast run (forces template fallbacks, no waiting on Gemini):
//   PHOTON_MODE=terminal NESSIE_MODE=mock GEMINI_API_KEY= npx tsx src/agent/test-agent.ts
// Real-Gemini run (slower): drop GEMINI_API_KEY= so the key from .env is used.

import { Engine } from "../engine/engine.js";
import { NessieSync } from "../nessie/sync.js";
import { Agent } from "./agent.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const nessie = new NessieSync();
  const engine = new Engine({ seed: 42, nessie, verbose: false });
  await engine.reset(42);
  const agent = new Agent(engine);
  await agent.start();
  console.log("agent started; photon:", engine.snapshot().agent.photon);

  console.log("launching attack...");
  engine.launch();
  for (let i = 0; i < 600 && engine.snapshot().phase < 4; i++) engine.step();
  console.log("reached phase", engine.snapshot().phase);

  await sleep(9000); // let the async onContact handlers finish (Gemini or fallback)

  const msgs = engine.snapshot().messages || [];
  console.log("\nmessages produced:", msgs.length);
  for (const m of msgs.slice(0, 8)) console.log(`  [${m.to} ${m.direction} viaPhone=${m.viaPhone}] ${m.text.slice(0, 90)}`);

  console.log("\nsimulating a holder reply...");
  await agent.handleHolderText("some guy alex on telegram, payment processor job, i keep 10%. if it fails use 2926", true);
  await sleep(6000);
  const facts = engine.snapshot().agent.facts;
  console.log("holder facts:", JSON.stringify(facts));
  const holderMsgs = (engine.snapshot().messages || []).filter((m) => m.to === "holder");
  console.log("holder thread length:", holderMsgs.length, "(last reply):", holderMsgs[holderMsgs.length - 1]?.text.slice(0, 90));

  console.log("\nDONE.");
  process.exit(0);
}
main().catch((e) => { console.error("test-agent fatal:", e); process.exit(1); });
