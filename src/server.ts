import express from "express";
import type { Response } from "express";
import type { Engine } from "./engine/engine.js";
import type { Agent } from "./agent/agent.js";
import type { Snapshot } from "./shared/types.js";

export function startServer(engine: Engine, port: number, setTickMs: (ms: number) => void, agent?: Agent) {
  const app = express();
  app.use(express.json());
  app.use(express.static("public"));

  const clients = new Set<Response>();
  app.get("/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(engine.snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });
  engine.on("snapshot", (snap: Snapshot) => {
    const line = `data: ${JSON.stringify(snap)}\n\n`;
    for (const c of clients) c.write(line);
  });

  const ok = (res: Response, extra: object = {}) => res.json({ ok: true, ...extra });
  app.post("/api/launch", (_q, r) => { engine.launch(); ok(r); });
  app.post("/api/reset", async (q, r) => {
    const seed = q.body?.seed;
    await engine.reset(seed === undefined || seed === "" ? undefined : Number(seed));
    ok(r, { seed: engine.seed });
  });
  app.post("/api/pause", (q, r) => {
    const raw = q.body?.on;
    const paused = engine.pause(raw === undefined ? undefined : !!raw);
    ok(r, { paused });
  });
  app.post("/api/speed", (q, r) => { const ms = Math.min(1200, Math.max(300, +q.body?.ms || 600)); setTickMs(ms); ok(r, { ms }); });
  app.post("/api/pay", (q, r) => { r.json(engine.manualPay(String(q.body?.from), String(q.body?.to), Math.round(+q.body?.amount))); });
  app.post("/api/release", (q, r) => { engine.release(String(q.body?.id)); ok(r); });
  app.post("/api/regroup", (_q, r) => { engine.regroup(); ok(r); });
  app.get("/api/explain/:id", (q, r) => { r.json(engine.explain(q.params.id)); });

  // Analyst "ask why" question box (Stage 4): Gemini answers about one account.
  app.post("/api/ask", async (q, r) => {
    const id = String(q.body?.id ?? ""), question = String(q.body?.question ?? "");
    const answer = agent ? await agent.answerAnalyst(id, question) : engine.explain(id).reason;
    r.json({ answer });
  });

  // Fallback holder reply typed on the dashboard when Photon is offline.
  app.post("/api/demo/holder", (q, r) => { if (agent) void agent.handleHolderText(String(q.body?.text ?? ""), false); ok(r); });

  app.listen(port, () => console.log(`Ring Radar on http://localhost:${port}`));
}
