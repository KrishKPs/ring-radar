import "dotenv/config";

const num = (v: string | undefined, d: number) => (v && !isNaN(+v) ? +v : d);

export const config = {
  port: num(process.env.PORT, 3000),
  tickMs: num(process.env.TICK_MS, 600),
  seed: process.env.SEED ? +process.env.SEED : undefined,
  nessie: {
    base: process.env.NESSIE_BASE ?? "https://api.nessieisreal.com",
    key: process.env.NESSIE_KEY ?? "",
    mode: (process.env.NESSIE_MODE ?? "live") as "live" | "mock",
  },
  photon: {
    projectId: process.env.SPECTRUM_PROJECT_ID ?? "",
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET ?? "",
    mode: (process.env.PHOTON_MODE ?? "imessage") as "imessage" | "terminal",
  },
  gemini: {
    key: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
    timeoutMs: num(process.env.GEMINI_TIMEOUT_MS, 9000),
  },
  phones: {
    victim: process.env.VICTIM_PHONE ?? "",
    holder: process.env.HOLDER_PHONE ?? "",
  },
};
