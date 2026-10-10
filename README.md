# Ring Radar

Ring Radar catches a scam mule ring while it is happening: it scores every transfer in a simulated bank network, detects the ring from the money pattern alone, freezes it and traces each victim's money. An agent then texts the victim and the account holder on real phones through Photon, with Gemini writing the messages and reading the replies. Built at HackNC 2026 by Krish and Hasti.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env     # then fill in your keys
npm run dev              # http://localhost:3000
```

Other commands:

```bash
npm run typecheck        # must pass before every commit
npm run eval -- 100      # accuracy evaluation over 100 seeds
npm run wipe             # delete demo data in Nessie
```

### Mock modes (no network needed)

- `NESSIE_MODE=mock`: skip all Nessie calls.
- `PHOTON_MODE=terminal`: use the terminal instead of iMessage.
- Gemini failures fall back to template messages automatically.

## Credits

**APIs and services**
- Capital One Nessie API (mock banking data): customers, accounts, transfers, withdrawals
- Photon Spectrum (`spectrum-ts`): iMessage agent messaging
- Google Gemini API (`@google/genai`): message writing and structured extraction

**Frameworks and libraries**
- Node.js, TypeScript, Express, dotenv, tsx

**AI assistance**
- We used Cursor with Claude Opus as an AI coding assistant to write and debug code during the hackathon,
  following our own design document. We designed the system, reviewed every change, and tested it ourselves.
- Gemini runs inside the product (see above).

**Fonts**
- Inter (Google Fonts)
