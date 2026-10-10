// src/agent/test-gemini.ts
// Stage 1 Gemini probe: one askText and one askJSON, printing each result and the
// time taken. Doubles as a VERIFY check for the model id (GEMINI_MODEL) and that
// the Interactions / legacy API shape in gemini.ts actually works.
//
// Run:  npx tsx src/agent/test-gemini.ts
// Needs GEMINI_API_KEY (and optionally GEMINI_MODEL) in .env

import { askText, askJSON } from "./gemini.js";
import { config } from "../config.js";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - start);
  console.log(`[${label}] took ${ms} ms`);
  return result;
}

async function main() {
  console.log(`Gemini test starting (model: ${config.gemini.model}, timeout: ${config.gemini.timeoutMs} ms)\n`);

  const text = await timed("askText", () =>
    askText(
      "Reply with one short, plain sentence about bank scams. No emoji, no markdown.",
      "Why do scammers move stolen money through several accounts within minutes?"
    )
  );
  console.log("askText result:", text ?? "(null — see the warning above)");
  console.log("");

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      risk: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["summary", "risk"],
  };
  const json = await timed("askJSON", () =>
    askJSON<{ summary: string; risk: string }>(
      "Classify the fraud risk of the situation described. Return JSON only.",
      "A two-day-old account received $2,000 from 3 strangers and forwarded all of it within minutes.",
      schema
    )
  );
  console.log("askJSON result:", json ?? "(null — see the warning above)");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("gemini test fatal:", e);
  process.exit(1);
});
