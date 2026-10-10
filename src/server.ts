import express from "express";
import type { Response } from "express";
import type { Engine } from "./engine/engine.js";
import type { Snapshot } from "./shared/types.js";

export function startServer(engine: Engine, port: number) {
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

  app.listen(port, () => console.log(`Ring Radar on http://localhost:${port}`));
}
