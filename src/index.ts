import { config } from "./config.js";
import { Engine } from "./engine/engine.js";
import { startServer } from "./server.js";

const engine = new Engine({ seed: config.seed });
await engine.reset(config.seed);

setInterval(() => engine.step(), config.tickMs);

startServer(engine, config.port);
