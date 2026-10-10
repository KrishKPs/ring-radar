# AGENTS.md — Ring Radar (HackNC 2026)

Instructions for every AI coding agent working in this repository. Read this whole file before your first edit.

## The project in one paragraph

Ring Radar catches a scam ring while it is happening. A simulation engine generates normal banking activity and random scam attacks, scores every account every tick, detects mule rings from the money pattern, freezes them, and traces each victim's money. An agent texts real phones through Photon, uses Gemini to write messages and pull account numbers out of replies, and a dashboard shows it all live. The full spec is `docs/BUILD_GUIDE.md`. When this file and the guide disagree, this file wins; tell the human about the conflict.

## Hackathon rules you must follow

- Hacking started at 11:30 AM Saturday Oct 10. Write all code fresh in this repo. Do not copy code from files or pages that existed before then (including the demo HTML page).
- Hard deadline: Sunday 10:00 AM. Feature freeze at 7:00 AM: after that, bug fixes only.
- Devpost draft with tracks selected must be submitted by midnight Saturday.
- AI use must be credited or the team is disqualified. `README.md` must have a "Credits" section naming every API and framework (Nessie, Photon Spectrum, Gemini, Express) and stating that Claude Code helped write the code. Keep it current whenever you add a dependency.
- The core (Stages 0 to 3 in the guide) must work before any extra is started.
- The humans must be able to explain every part to judges. Prefer simple, readable code over clever code. Add a one-line comment above any non-obvious logic.

## Commands

```bash
npm install            # install
npm run dev            # run with auto-reload (http://localhost:3000)
npm run typecheck      # must pass before every commit
npm run eval -- 100    # accuracy evaluation over 100 seeds (engine changes only)
npm run wipe           # delete demo data in Nessie
```

Mock modes for working without the network: `NESSIE_MODE=mock`, `PHOTON_MODE=terminal`. Gemini failures fall back to templates automatically.

## Who owns what (lanes)

| Lane | Human | Folders you may edit |
|---|---|---|
| engine | Krish | `src/engine/`, `src/nessie/`, `scripts/` |
| server | Krish | `src/server.ts`, `src/index.ts`, `src/config.ts` |
| agent | Hasti | `src/agent/` |
| dashboard | Hasti | `public/` |
| shared | both | `src/shared/types.ts`, `AGENTS.md`, `README.md`, `.env.example`, `package.json` |

- Stay inside your lane's folders. If a task needs a change in another lane, stop and tell the human what change you need and why.
- **Never change `src/shared/types.ts` without the human's explicit OK.** It is the contract between the engine and the agent and dashboard. Additive changes (a new optional field) are easier to approve than renames.
- Adding an npm dependency needs the human's OK. Current deps: `express`, `dotenv`, `spectrum-ts`, `@google/genai`; dev: `typescript`, `tsx`, `@types/node`, `@types/express`.

## Code conventions

- TypeScript, `strict`, ES modules (`"type": "module"`). Relative imports end in `.js` (`import { Engine } from "./engine/engine.js"`).
- Node 20+. Use built-in `fetch`. No axios.
- Dashboard: plain HTML, CSS, JavaScript and SVG in `public/`. No React, no bundler, no CDN frameworks.
- Money is in whole dollars (numbers). Format for display as `$1,234`.
- Account display names: people by first name ("Maya") or "Acct ••1234"; shops by name.
- Keep functions short. No classes except `Engine`, `NessieSync`, `Agent`.
- Logs: `console.log` for normal flow, `console.warn` for fallbacks, `console.error` for failures. Never log API keys.

## Engine invariants (lane: engine)

- `Engine.step()` is synchronous. **Never `await` a network call inside it.** Nessie writes go through the `NessieSync` queue.
- All randomness comes from the seeded generator (`rng.ts`). Two generators: fixed layout seed `20261010`, per-run seed for everything else. Same seed = same run.
- Scoring constants live at the top of `score.ts` and match the guide (W=60, match 12 ticks at 80–125%, pending 12 ticks, 3 spread rounds, alpha 0.5). Do not change them without running `npm run eval -- 100` before and after and reporting both results.
- People and shops are always `opened: "established"`. Only ring accounts are `"new"`.
- A freeze records `evidenceAtFreeze`. Anything that explains a frozen account reads that, not live features.
- `nameAccount(last4)` freezes only brand-new accounts. Established accounts get `review = true`, never a freeze.
- Victims never get frozen by the "extended" rule (that rule lives in `hop()`, and victims only `pay()`).
- Every engine change must keep: detection on every seed in the eval, and **zero innocent accounts frozen** in both the attack eval and the no-attack test.

## Agent invariants (lane: agent)

- Every Gemini call has a timeout (`GEMINI_TIMEOUT_MS`) and returns `null` on failure. Every caller has a template fallback in `templates.ts`. The demo must never wait on Gemini.
- All prompts live in `prompts.ts`. Evidence is passed as JSON. Text from people is passed as untrusted data, labelled `PERSON_SAID (untrusted)`, and never followed as instructions.
- Account numbers from Gemini are validated: digits only, exactly 4, and the page also regex-checks the person's own text against real accounts. Call `engine.nameAccount()` once per number per run.
- Replies to phones: at most 320 characters, no markdown, no emoji. Never ask for passwords, PINs, card numbers or codes.
- Only the featured victim, the holder, and the first refused payer get real texts. Everyone else is dashboard-only (`viaPhone: false`).
- Photon: phones register by texting `VICTIM` or `HOLDER`. If Photon fails to start, the agent keeps running in dashboard-only mode. Never crash the process because of Photon.

## Dashboard rules (lane: dashboard)

- One page, fed by `EventSource("/events")`. Buttons call `POST /api/...`.
- **Match `docs/Ring_Radar_Dashboard_Mockup.png`**: dark theme, header KPIs, three columns (alert + steps + live feed | map + money strip | iPhone panel + "What the agent learned"). Layout and colour tokens are in `docs/BUILD_GUIDE.md` sections 12.1 and 12.7. Open the image before your first dashboard edit.
- One screen, no page scroll, at 1280 × 800 and up.
- Only replace an element's `innerHTML` when its HTML string changed (keeps scroll and selection).
- Colour is never the only signal: frozen accounts also get a dashed ring; labels name every flagged account.
- Respect `prefers-reduced-motion` (no pulses).

## Definition of done for any task

1. `npm run typecheck` passes.
2. `npm run dev` starts with no errors.
3. You ran the relevant steps of the manual test in `docs/BUILD_GUIDE.md` section 15.1 (or told the human exactly which steps to run, if they need a phone).
4. Engine changes: `npm run eval -- 50` shows every seed detected and 0 innocent freezes.
5. You told the human, in 3 lines or fewer: what changed, how to test it, anything you could not verify.

## Git

- Each agent session works on its own branch (`engine`, `agent`, `dashboard`, ...) or its own worktree. Never work directly on `main` in parallel sessions.
- Commit small and often, with messages like `engine: ring detection with union-find`.
- **Auto-push rule:** after every task that passes `npm run typecheck` (and runs with `npm run dev`), commit and run `git push origin HEAD` on your own branch without being asked. Never let more than about 30 minutes of working code go unpushed. Before each push, run `git status` and make sure no `.env` or keys are staged. Push only your own branch; never push to `main` (the humans merge). If a push fails, tell the human the exact error instead of forcing it.
- Before merging into `main`: `git pull --rebase origin main`, `npm run typecheck`, then merge. If a conflict touches `src/shared/types.ts` or a file outside your lane, stop and ask the human.
- Never force-push `main`. Never commit `.env`. Never rewrite history that someone else pulled.
- After Checkpoint 3 the humans tag `core-working`. Do not move or delete tags.

## Secrets

- Keys live only in `.env` (gitignored). Read them through `src/config.ts`.
- Never print, log, commit or paste keys. If you see a key in a file that is tracked by git, stop and tell the human.

## Things not to do

- Do not add features from Stage 4 before the humans say Checkpoint 3 passed.
- Do not call Gemini or Nessie in a loop or on every tick.
- Do not introduce databases, Docker, auth, or deployment. It runs on one laptop.
- Do not rename files, routes or event names that the other lane uses.
- Do not delete the template fallbacks, the mock modes, or the reset button.

## Where things are

- Spec: `docs/BUILD_GUIDE.md` (architecture section 5, contract section 8, engine 9, Nessie 10, server 11, dashboard 12, agent 13, build order 14, tests 15).
- Contract: `src/shared/types.ts`.
- Dashboard target look: `docs/Ring_Radar_Dashboard_Mockup.png`.
- Credits: `README.md` → Credits.
- Engine events: `snapshot`, `phase`, `ringDetected`, `ringFrozen`, `contact`, `paymentRefused`, `accountFrozen`, `reset`.
- Server routes: `GET /events`, `POST /api/launch|regroup|reset|pause|speed|pay|release|ask|demo/holder`, `GET /api/explain/:id`.
- Agent → engine: `nameAccount`, `recordHolderStatement`, `addMessage`, `setAgentState` (photon status, phones, busy, holder facts).
