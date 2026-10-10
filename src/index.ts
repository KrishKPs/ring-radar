import { config } from "./config.js";
import { Engine } from "./engine/engine.js";
import { NessieSync } from "./nessie/sync.js";
import { startServer } from "./server.js";

const nessie = new NessieSync();
const engine = new Engine({ seed: config.seed, nessie, verbose: true });
await engine.reset(config.seed);

setInterval(() => engine.step(), config.tickMs);

startServer(engine, config.port);
