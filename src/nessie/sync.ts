import { nessie } from "./client.js";
import type { NessieStatus, Transfer } from "../shared/types.js";
import { config } from "../config.js";

const GAP_MS = 120;

export class NessieSync {
  private q: Array<() => Promise<void>> = [];
  private busy = false;
  idOf = new Map<string, string>();   // engine account id -> Nessie account id
  sent = 0; failed = 0; lastError = "";
  settingUp = false;

  get live() { return config.nessie.mode === "live"; }

  /** Forget the previous run: its pending jobs, account ids and counts. */
  clear() { this.q = []; this.idOf.clear(); this.sent = 0; this.failed = 0; this.lastError = ""; }

  status(): NessieStatus {
    return { live: this.live, settingUp: this.settingUp, accounts: this.idOf.size, sent: this.sent, failed: this.failed };
  }

  enqueue(job: () => Promise<void>) { this.q.push(job); void this.drain(); }

  // One request at a time with a short gap; a failure is logged and never stops the demo
  private async drain() {
    if (this.busy) return;
    this.busy = true;
    while (this.q.length) {
      const job = this.q.shift()!;
      try { await job(); this.sent++; }
      catch (e) { this.failed++; this.lastError = String(e); console.error(e); }
      await new Promise(r => setTimeout(r, GAP_MS));
    }
    this.busy = false;
  }

  recordTransfer(t: Transfer) {
    if (!this.live) return;
    const from = this.idOf.get(t.from);
    if (!from) return;                                   // background account: memory only
    if (t.to === "OUT") { this.enqueue(async () => { await nessie.withdraw(from, t.amount, `cash-out tick ${t.tick}`); }); return; }
    const to = this.idOf.get(t.to);
    if (!to) return;
    this.enqueue(async () => { await nessie.transfer(from, to, t.amount, `${t.kind} tick ${t.tick}`); });
  }

  /** Create the story accounts. Awaited during reset, before the tick loop starts. */
  async createAccounts(list: Array<{ engineId: string; first: string; nickname: string; balance: number }>) {
    if (!this.live) return;
    this.settingUp = true;
    try {
      for (const a of list) {
        const c = await nessie.createCustomer(a.first, "Demo");
        const acct = await nessie.createAccount(c, a.nickname, a.balance);
        this.idOf.set(a.engineId, acct);
      }
    } finally {
      this.settingUp = false;
    }
  }
}
