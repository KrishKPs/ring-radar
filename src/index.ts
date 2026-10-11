import { config } from "./config.js";
import { Engine } from "./engine/engine.js";
import { NessieSync } from "./nessie/sync.js";
import { startServer } from "./server.js";
import { Agent } from "./agent/agent.js";

const nessie = new NessieSync();
const engine = new Engine({ seed: config.seed, nessie, verbose: true });
await engine.reset(config.seed);

const agent = new Agent(engine);
void agent.start(); // listeners register synchronously; Photon connects in the background so the server never waits on it

let timer = setInterval(() => engine.step(), config.tickMs);
const setTickMs = (ms: number) => { clearInterval(timer); timer = setInterval(() => engine.step(), ms); };

startServer(engine, config.port, setTickMs, agent);
