import express from "express";
import { config } from "./config.js";

// Stage 0 skeleton: the engine, agent and server.ts (section 11) replace this in Stage 1.
const app = express();
app.use(express.static("public"));

app.listen(config.port, () => console.log(`Ring Radar on http://localhost:${config.port}`));
