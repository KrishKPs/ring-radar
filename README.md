# Ring Radar

**Catch a scam ring while it's happening, freeze it, trace the money, and talk to everyone involved.**

Ring Radar watches a bank's payments as they happen, spots a scam "mule ring" from the money pattern alone, freezes the whole ring at once, follows every victim's dollar, and texts the people involved on real phones. Built in 22 hours at **HackNC 2026** by Krish and Hasti.

![Ring Radar dashboard: a frozen ring of 5 accounts, the agent's iMessage conversation with the account holder, and what Gemini extracted from the reply](docs/screenshot.png)

- **Demo video:** add the unlisted YouTube link here
- **Devpost:** https://hacknc-2026.devpost.com

---

## The problem

Americans reported losing **$15.9 billion** to fraud in 2025, the most on record (FTC Consumer Sentinel), and most losses are never reported. Scam money doesn't sit still: it passes through several "mule" accounts within minutes and is cashed out before anyone notices. Each victim only sees their own payment, so the pattern is invisible from inside any single account. And many mule-account holders are students recruited through fake job offers, who don't know they're part of a crime.

## What it does

1. **Watch.** A simulated bank network makes normal payments (paychecks, rent, groceries, friends) and, on Launch, a random scam attack.
2. **Detect.** Every account is scored on three behaviours: money from people who never paid it before, money passed on within minutes, and account age. Risk then spreads across the transfer graph. A ring is a connected group of suspicious accounts fed by at least three outside senders.
3. **Freeze.** The whole ring is frozen at once, so money still inside it is stopped and new payments into it are refused.
4. **Trace.** Each victim's payment is followed hop by hop: **stopped**, **cashed out**, or **refused**.
5. **Talk.** The agent texts the victim and the recruited account holder on real phones through **Photon**. **Gemini** writes each message from the evidence and pulls account numbers out of free-text replies. When the holder names the ring's backup account, it is frozen within seconds, before the scammers can use it.
6. **Report.** A case file is written for the bank's fraud team. If the scammers regroup for a second wave, every payment is refused (or caught by the same pattern if nobody told us about the backup).

**Who uses it:** a bank or credit union's fraud team runs the dashboard. Customers never install anything; they just get a text.

## Tracks

- **General**
- **Best iMessage Agent with Photon**: an agent that starts conversations, reads free-text replies, and acts on them (freezing an account).
- **The Best Use of Nessie with Capital One**: every account, scam transfer and cash-out in the story is a real Nessie record.
- **[MLH] Best Use of Gemini API**: Gemini writes messages from structured evidence and extracts structured facts from messy human replies.
- **Community**

## How it works

```
                      contact / paymentRefused events
  ┌───────────────┐ ───────────────────────────────▶ ┌──────────┐  evidence / reply   ┌────────┐
  │    Engine     │                                  │  Agent   │ ◀─────────────────▶ │ Gemini │
  │ 1 simulate    │ ◀─────────────────────────────── │          │  message / JSON     └────────┘
  │ 2 score       │    nameAccount(••2674): freeze   └────┬─────┘
  │ 3 spread risk │                                       │ send / receive
  │ 4 find rings  │                                  ┌────▼─────┐  iMessage   ┌──────────────┐
  │ 5 freeze      │                                  │  Photon  │ ◀─────────▶ │ victim phone │
  │ 6 trace       │                                  └──────────┘             │ holder phone │
  └──┬────────┬───┘                                                           └──────────────┘
     │        │ snapshot every tick        ┌────────┐   SSE /events   ┌───────────┐
     │        └──────────────────────────▶ │ Server │ ──────────────▶ │ Dashboard │
     │                                     │Express │ ◀────────────── │ (browser) │
     │ background queue                    └────────┘   POST /api/…   └───────────┘
     ▼
  ┌──────────────────────┐   HTTPS   ┌────────────────────┐
  │ NessieSync queue     │ ────────▶ │ Capital One Nessie │
  └──────────────────────┘           └────────────────────┘
```

One Node.js + TypeScript process on one laptop. The engine runs a synchronous tick loop (one tick = 15 seconds of bank time, 0.6 seconds of real time) and **never waits on the network**: Nessie writes go through a background queue, and Gemini and Photon calls happen in the agent, outside the tick.

### Scoring, in numbers

| Feature (last 60 ticks = 15 bank-minutes) | What it measures |
|---|---|
| New senders | People who had never paid this account before |
| Passed on | Share of money that left again within 12 ticks (3 bank-minutes) at 80% to 125% of the amount received |
| Young | The account was opened this week |

`base = 0.5·passedOn·newSenders + 0.25·passedOn·young + 0.25·young·newSenders` (new senders capped at 3). Risk then spreads for 3 rounds: each account moves halfway (α = 0.5) toward its trading partners' dollar-weighted risk, never below its own base. Shops and normal people **keep** the money they receive, so they never match the pattern.

### Freeze rules

| Rule | When it fires |
|---|---|
| 1 Ring | 3+ suspicious accounts linked by payments, fed by 3+ outside senders (union-find over the payment graph) |
| 2 Freeze | Freeze the whole ring, re-score, then freeze accounts the ring fed that now look risky (catches the exit) |
| 3 Joined | A suspicious account that sent money into the frozen ring joins it |
| 4 Extended | An account tries to pass money into a frozen account (victims are exempt: they only pay, never pass money on) |
| 5 Lone | An account that looks like a mule on its own and cashes out (the backup in wave 2) |
| 6 Named | The account holder names an account: frozen **only** if it is brand new; an established account goes to an analyst for review |

Victims are never frozen by these rules. Every freeze stores the evidence it was based on, and an analyst can release any account in one click.

## How we use each sponsor API

**Capital One Nessie.** On every New run the story's customers and accounts are created in Nessie, and every scam payment and cash-out is written as a Nessie transfer or withdrawal through a background queue. What we verified about the API: transfers take no payee field, so we write the receiver's Nessie id into the description; transfers stay `pending` and balances never change, so the dashboard shows the **record count**, not balances. Nessie has no "hold" feature, so the freeze is ours.

**Photon Spectrum (`spectrum-ts`).** Real iMessages in both directions. Phones register by texting `VICTIM` or `HOLDER` to the bot (Photon's shared-pool lines can't text a new number first, and each registered person gets their own bot number). The agent texts the featured victim, the account holder, and the first person whose payment was refused; everyone else is shown on the dashboard only. If Photon fails to start, the agent keeps running in dashboard-only mode with a reply box.

**Google Gemini (`@google/genai`).** Two jobs: write each text from the frozen ring's evidence (passed as JSON), and extract facts (recruiter, lure, account numbers, intent) from the holder's free-text reply with a JSON schema. The person's text is passed as clearly labelled untrusted data and never followed as instructions. Extracted account numbers must be exactly 4 digits and are checked against the person's own words before anything is frozen. Every call has a timeout and falls back to a template, so the demo never waits on Gemini.

## How accurate is it?

`npm run eval -- 100` runs 100 random attacks plus a quiet run with no attack for each seed. Same seed, same run, so every number can be reproduced.

| Measure | Seeds 1000–1099 | Fresh seeds 9000–9099 |
|---|---|---|
| Rings detected | 100% | 100% |
| Ring accounts frozen | 100% | 100% |
| Innocent accounts frozen | 0 | 0 |
| Accounts frozen with no attack | 0 | 0 |
| Scam money stopped before it left | 87.9% | 87.2% |
| Median time to detect | 3.3 bank-minutes | 3.3 bank-minutes |

The thresholds were never tuned on seeds 9000–9099 (`EVAL_FIRST_SEED=9000 npm run eval -- 100`). **Honest limits:** the bank and the attacks are simulated by our own engine. The pattern it looks for (new accounts, money from strangers, passed on within minutes) is how real mule rings behave, but real bank data would be messier; testing on it is the next step.

## Safety

- The agent never asks for passwords, PINs, card numbers or codes, and texts are capped at 320 characters with no markdown or emoji.
- One person's word never freezes an established account; it goes to review.
- Holder replies are treated as untrusted input to Gemini.
- Victims are never frozen by the ring rules, and every frozen account can be released by an analyst.
- API keys live only in `.env`, which is gitignored.

## Run it

Requires Node.js 20 or newer.

```bash
git clone https://github.com/KrishKPs/ring-radar.git
cd ring-radar
npm install
cp .env.example .env     # then fill in your keys (or use the mock modes below)
npm run dev              # http://localhost:3000
```

**Try it with no keys and no network:**

```bash
NESSIE_MODE=mock PHOTON_MODE=terminal npm run dev
```

Gemini failures fall back to template messages automatically, so this runs fully offline.

| Variable | What it's for |
|---|---|
| `NESSIE_KEY`, `NESSIE_MODE` | Capital One Nessie key; `mock` skips all Nessie calls |
| `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`, `PHOTON_MODE` | Photon project; `terminal` uses the terminal instead of iMessage |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS` | Gemini (default model `gemini-3.1-flash-lite`) |
| `SEED`, `TICK_MS`, `PORT` | Fixed run seed, tick speed, port |

**Driving the demo** (keyboard on the dashboard, or the ⚙ menu top right):

| Key | Action |
|---|---|
| `A` | Launch a scam attack |
| `G` | Let the scammers regroup (wave 2) |
| `M` | Money trail view |
| `C` | Open / minimize the case file |
| `N` | New run |
| `Space` | Pause / resume |
| `R` | Reset the map zoom |

Click any account on the map to see why it was scored that way, ask a follow-up question (Gemini), or release it.

**Other commands:**

```bash
npm run typecheck        # TypeScript check
npm run eval -- 100      # accuracy evaluation over 100 seeds
npm run wipe             # delete demo data in Nessie
```

### Project layout

```
src/engine/    world, scoring (score.ts), ring detection (detect.ts), explanations, case file
src/nessie/    Nessie client and background sync queue
src/agent/     Photon messaging, Gemini calls, prompts, template fallbacks
src/server.ts  Express routes and the /events stream
src/shared/    the contract between engine, agent and dashboard (types.ts)
public/        the dashboard (plain HTML, CSS, SVG; no framework, no build step)
scripts/       accuracy evaluation and Nessie tools
docs/          design document and dashboard mockup
```

## Challenges

- **Matching money in to money out without false matches.** Shops and payroll also receive from many people, so "many new senders" alone would freeze innocent accounts. Requiring money to be passed on within a short window, at a similar amount, fixed that.
- **Nessie's real behaviour differed from what we expected** (no payee field, balances that never move), so we redesigned what the dashboard shows around record counts.
- **Keeping detection fast while three network services run.** The engine is synchronous and never awaits a network call; everything slow is queued or happens in the agent.
- **Photon's shared lines can't text a new number first**, so phones register by texting the bot once.
- **We hit Gemini's free-tier daily limit mid-hackathon**; the template fallbacks kept everything running while we switched models.

## What's next

- Real-time scoring inside a bank's payment flow, on real (messier) data
- Sharing confirmed mule accounts between banks
- A softer first step: hold individual payments to suspicious accounts before a ring is confirmed

## Team

- **Krish:** detection engine, scoring and freeze rules, Nessie integration, server, accuracy evaluation
- **Hasti:** iMessage agent, Photon and Gemini integration, prompts, dashboard

## Credits

**APIs and services**
- Capital One Nessie API (mock banking data): customers, accounts, transfers, withdrawals
- Photon Spectrum (`spectrum-ts`): iMessage agent messaging
- Google Gemini API (`@google/genai`): message writing and structured extraction

**Frameworks and libraries**
- Node.js, TypeScript, Express, dotenv, tsx

**Data**
- Fraud loss figure: FTC Consumer Sentinel Network (2025 data)

**AI assistance**
- We used **Claude Code** (Anthropic) and Cursor (with Claude) as AI coding assistants to write and debug the code during the hackathon, following our own design document (`docs/BUILD_GUIDE.md`). Commits it helped write carry a `Co-Authored-By: Claude` line. We designed the system, reviewed every change, and tested it ourselves on real phones.
- Gemini runs inside the product (see above).

**Fonts**
- Inter and JetBrains Mono (Google Fonts)
