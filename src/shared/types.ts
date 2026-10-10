// src/shared/types.ts

/** What kind of account this is. Shops include the employer. "acct" = an account in the scam ring. */
export type AccountKind = "person" | "shop" | "acct";

/** Role inside the ring. Only set for kind "acct". */
export type RingRole = "mule" | "collector" | "exit" | "backup";

/** Measured over the last W transfers (section 9.5). */
export interface Features {
  newSenders: number;   // distinct senders who had never paid this account before the window
  passedOn: number;     // 0..1, share of incoming money forwarded within MATCH_TICKS
  received: number;     // dollars received in the window
  young: 0 | 1;         // 1 = newly opened account
}

export interface Account {
  id: string;           // engine id: "P12", "S3", "M0", "COL", "EXIT", "BK"
  name: string;         // display: "Maya" or "Acct ••4471" or "Campus Grocery"
  last4?: string;       // for ring and unnamed accounts: "4471"
  kind: AccountKind;
  role?: RingRole;
  victim?: boolean;     // planned victim of this run
  x: number; y: number; // map position in a 900 x 560 box
  opened: "established" | "new";
  nessieAccountId?: string;  // filled in once created in Nessie
  balance?: number;          // last balance read from Nessie (shown on dashboard)

  // live state
  base: number;         // behaviour score 0..1
  risk: number;         // after risk spreading 0..1
  features: Features;
  frozen: boolean;
  released: boolean;    // analyst said "flagged by mistake"
  review: boolean;      // named by a holder but established: waiting for analyst
  // why it was frozen (exactly one is set when frozen)
  frozenBecause?: "ring" | "downstream" | "joined" | "extended" | "lone" | "named";
  frozenVia?: string;   // account id that links it to the ring, for "joined" and "extended"
  evidenceAtFreeze?: Features & { base: number; tick: number };
}

export type TransferKind = "normal" | "pay" | "hop" | "cashout" | "manual";

export interface Transfer {
  tick: number;
  from: string;               // account id
  to: string;                 // account id, or "OUT" for a cash-out
  amount: number;
  kind: TransferKind;
  blocked: boolean;           // true = refused because an end was frozen
}

export type ParcelStatus = "moving" | "stopped" | "lost" | "refused";

/** One victim's payment, followed through the ring. */
export interface Parcel {
  id: number;
  victim: string;             // account id of the victim
  amount: number;
  at: string;                 // where the money is now
  path: string[];             // account ids it passed through, "OUT" at the end if cashed out
  status: ParcelStatus;
  wave: 1 | 2;
}

/** 0 watching, 1 detected, 2 frozen, 3 traced, 4 contacted, 5 case file */
export type Phase = 0 | 1 | 2 | 3 | 4 | 5;

export interface Totals {
  scored: number;             // transfers scored since start
  frozen: number;             // accounts frozen
  stopped: number;            // dollars
  lost: number;               // dollars
  refused: number;            // dollars
}

/** What the engine hands the agent when a ring is frozen. Agreed in Stage 0. */
export interface FreezeReport {
  tick: number;
  ringAccountIds: string[];
  holder: {                   // the account holder the agent talks to
    accountId: string;
    accountName: string;
    received: number;
    newSenders: number;
    passedOnPct: number;
  };
  victims: Array<{
    accountId: string;
    name: string;
    amount: number;
    status: ParcelStatus;     // stopped | lost | refused
    whereName: string;        // account where it stopped, or where it was refused
    hops: number;
  }>;
  totals: Totals;
}

export interface LogLine { tick: number; clock: string; text: string; key: boolean }

/** Sent to the browser every tick. Keep it small. */
export interface Snapshot {
  tick: number;
  clock: string;              // simulated time "14:05:45"
  phase: Phase;
  attackRunning: boolean;
  wave2: "idle" | "ready" | "running" | "done";
  backupKnownBeforeWave2: boolean | null;
  accounts: Array<Pick<Account,
    "id" | "name" | "kind" | "x" | "y" | "base" | "risk" | "frozen" | "released" | "review" | "victim" | "balance">>;
  edges: Array<{ from: string; to: string; lastTick: number; blocked: boolean }>;
  newTransfers: Transfer[];   // only the ones made this tick, for animation
  parcels: Parcel[];
  totals: Totals;
  log: LogLine[];             // newest first, at most 50
  caseFile: string | null;    // filled at phase 5
  messages: AgentMessage[];   // what the agent has sent and received, for the dashboard

  // ---- added for the dashboard mockup (section 12) ----
  feed: FeedItem[];           // last 12 transfers with their score, newest first (left column)
  phaseClock: (string | null)[]; // index = phase; simulated clock when that phase started, null if not yet
  metrics: {
    attackToFreezeSec: number | null; // simulated seconds from the first scam payment to the ring freeze
    ringSize: number;                 // accounts in the detected ring (0 before detection)
    ringRisk: number;                 // highest risk inside the ring, 0..1
  };
  agent: AgentState;          // set by the agent through engine.setAgentState()
}

/** One row of the live transfer feed. */
export interface FeedItem {
  tick: number;
  clock: string;
  fromName: string;
  toName: string;             // "Cashed out" for OUT
  amount: number;
  score: number;              // receiver's risk after this tick's scoring, 0..1
  blocked: boolean;           // shown as BLOCK instead of a score
}

/** What the agent learned from the account holder (Gemini prompt C, section 13.5). */
export interface HolderFacts {
  recruiter: string | null;   // "Alex, on Telegram"
  lure: string | null;        // "payment processor job"
  namedAccounts: Array<{ last4: string; result: "frozen" | "already-frozen" | "review" | "unknown" }>;
  intent: "unaware" | "knowing" | "unclear";
}

export interface AgentState {
  photon: "connected" | "dashboard-only" | "starting";
  phones: { victim: boolean; holder: boolean };  // registered by texting VICTIM / HOLDER
  busy: boolean;              // true while Gemini is writing a holder reply
  facts: HolderFacts | null;
}

export interface AgentMessage {
  at: number;                 // tick
  to: "victim" | "holder" | "payer";
  direction: "out" | "in";
  personName: string;
  text: string;
  viaPhone: boolean;          // true = really sent to a phone; false = dashboard only
}
