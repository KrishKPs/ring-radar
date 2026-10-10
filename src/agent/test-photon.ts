// src/agent/test-photon.ts
// Stage 1 Photon probe. Does two things:
//  1. Tries startDM to VICTIM_PHONE to find out whether the bot can text a phone
//     FIRST (shared-pool projects usually cannot).
//  2. Echoes any text you send and prints the RAW fields (direction, sender.id,
//     platform, content.type) so we can fix the lines marked VERIFY in photon.ts.
//
// Run:  npx tsx src/agent/test-photon.ts
// Terminal mode (no keys):   PHOTON_MODE=terminal npx tsx src/agent/test-photon.ts
// iMessage mode needs SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET in .env,
// iMessage connected in the Photon dashboard, and VICTIM_PHONE set for the startDM test.

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { config } from "../config.js";

// Show only the last 4 digits of a phone number in logs.
function maskPhone(phone: string): string {
  return phone.length > 4 ? "•••" + phone.slice(-4) : phone;
}

async function main() {
  const mode = config.photon.mode;
  console.log(`Photon test starting in ${mode} mode...`);

  const providers = mode === "terminal" ? [terminal.config()] : [imessage.config()];
  const app: any = await Spectrum({
    projectId: config.photon.projectId || undefined,
    projectSecret: config.photon.projectSecret || undefined,
    providers,
  } as any);
  console.log("Connected. Text me anything from your iPhone and I'll echo it back.");
  console.log("(Try: VICTIM, HOLDER, or any sentence.)\n");

  // 1. Can the bot text a phone first?
  if (mode === "imessage" && config.phones.victim) {
    try {
      const im: any = imessage(app);
      const user = await im.user(config.phones.victim);
      const dm = await im.space.create(user);
      await dm.send("Ring Radar startDM test: if you see this, the bot can text first.");
      console.log(`startDM: SUCCESS — sent a first text to ${maskPhone(config.phones.victim)}.`);
    } catch (e) {
      console.log(`startDM: FAILED — bot cannot text first (expected on a shared pool). ${String(e)}`);
    }
  } else {
    console.log("startDM: skipped (terminal mode, or VICTIM_PHONE not set).");
  }
  console.log("");

  // 2. Receive loop: print raw fields and echo.
  for await (const [space, message] of app.messages) {
    try {
      const m: any = message;
      console.log("---- incoming message ----");
      console.log("content.type :", m.content?.type);
      console.log("direction    :", m.direction);
      console.log("sender.id    :", m.sender?.id);
      console.log("platform     :", m.platform);
      if (m.content?.type === "text") {
        const text: string = m.content.text;
        console.log("text         :", text);
        // Guard against echoing our own echoes (prevents a loop whatever direction means).
        const isOwnEcho = text.startsWith("echo: ");
        const looksOutbound = m.direction === "outbound";
        if (!isOwnEcho && !looksOutbound) {
          await space.send("echo: " + text);
        }
      }
    } catch (e) {
      console.error("receive error", e);
    }
  }
}

main().catch((e) => {
  console.error("photon test fatal:", e);
  process.exit(1);
});
