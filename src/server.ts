import express from "express";
import type { Response } from "express";
import type { Engine } from "./engine/engine.js";
import type { Agent } from "./agent/agent.js";
import type { Snapshot } from "./shared/types.js";

export function startServer(engine: Engine, agent: Agent, port: number, setTickMs: (ms: number) => void) {
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
  app.get("/api/explain/:id", (q, r) => { r.json(engine.explain(q.params.id)); });
  // Wave 2 is a Stage 4 extra; the route exists so the dashboard button has somewhere to post.
  app.post("/api/regroup", (_q, r) => { r.status(501).json({ ok: false, error: "regroup not built yet" }); });
  app.post("/api/ask", async (q, r) => {
    r.json({ answer: await agent.answerAnalyst(String(q.body?.id), String(q.body?.question ?? "").slice(0, 200)) });
  });
  // Fallback when Photon is down: a holder reply typed on the dashboard.
  app.post("/api/demo/holder", async (q, r) => {
    const text = String(q.body?.text ?? "").trim().slice(0, 300);
    if (!text) { r.status(400).json({ ok: false, error: "text required" }); return; }
    await agent.handleHolderText(text, false);
    ok(r);
  });

  app.listen(port, () => console.log(`Ring Radar on http://localhost:${port}`));
}
