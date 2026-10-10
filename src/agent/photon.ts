// src/agent/photon.ts
// Photon (Spectrum) messaging for Ring Radar.
// Supports PHOTON_MODE=terminal (no credentials) and PHOTON_MODE=imessage (Pro project).
// Credentials come from src/config.ts and are never logged.

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { config } from "../config.js";

export type Space = { send: (text: string) => Promise<unknown> };
export type Incoming = { space: Space; senderId: string; text: string };

export interface Photon {
  app: unknown;
  // Try to open a conversation with a phone first. Returns a Space on success,
  // or null if the number routing does not allow texting first (shared pool).
  startDM: (phone: string) => Promise<Space | null>;
}

export async function connectPhoton(onText: (m: Incoming) => void): Promise<Photon> {
  const providers = config.photon.mode === "terminal" ? [terminal.config()] : [imessage.config()];
  // Spectrum also reads SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET from the env.
  const app: any = await Spectrum({
    projectId: config.photon.projectId || undefined,
    projectSecret: config.photon.projectSecret || undefined,
    providers,
  } as any);

  // Receive loop runs in the background for the life of the process.
  void (async () => {
    for await (const [space, message] of app.messages) {
      try {
        const m: any = message;
        if (m.content?.type !== "text") continue;
        // Skip our own outgoing messages and non-text events. VERIFIED 2026-10-10
        // with test-photon.ts: inbound texts have direction "inbound", sender.id is
        // the E.164 phone (e.g. "+1XXXXXXXXXX"), platform "imessage"; read receipts
        // arrive as content.type "read" (filtered out above).
        if (m.direction && m.direction !== "inbound") continue;
        onText({ space, senderId: m.sender?.id ?? "unknown", text: m.content.text });
      } catch (e) {
        console.error("photon receive error", e);
      }
    }
  })();

  async function startDM(phone: string): Promise<Space | null> {
    try {
      const im: any = imessage(app);
      const user = await im.user(phone);
      return (await im.space.create(user)) as Space;
    } catch (e) {
      console.warn("photon: cannot start a DM first to", maskPhone(phone), String(e));
      return null;
    }
  }

  return { app, startDM };
}

// Show only the last 4 digits of a phone number in logs.
function maskPhone(phone: string): string {
  return phone.length > 4 ? "•••" + phone.slice(-4) : phone;
}
