import { config } from "./config.js";
import { Engine } from "./engine/engine.js";
import { NessieSync } from "./nessie/sync.js";
import { Agent } from "./agent/agent.js";
import { startServer } from "./server.js";

const nessie = new NessieSync();
const engine = new Engine({ seed: config.seed, nessie, verbose: true });
await engine.reset(config.seed);

const agent = new Agent(engine);
await agent.start(); // never throws: falls back to dashboard-only if Photon fails

let timer = setInterval(() => engine.step(), config.tickMs);
const setTickMs = (ms: number) => { clearInterval(timer); timer = setInterval(() => engine.step(), ms); };

startServer(engine, agent, config.port, setTickMs);
