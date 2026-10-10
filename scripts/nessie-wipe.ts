// Deletes every account under our Nessie key, so judges see a clean account list. Usage: npm run wipe
// This Nessie has no bulk DELETE /data and no customer delete, so accounts go one by one and customers stay.
import { config } from "../src/config.js";
import { rawCall } from "../src/nessie/client.js";

if (!config.nessie.key) {
  console.error("NESSIE_KEY is empty. Put it in .env first.");
  process.exit(1);
}

const list = await rawCall("GET", "/accounts");
if (list.status !== 200) {
  console.error(`Could not list accounts: ${list.status} ${list.text.slice(0, 200)}`);
  process.exit(1);
}
const accounts = JSON.parse(list.text) as Array<{ _id: string }>;
console.log(`Deleting ${accounts.length} accounts...`);

let failed = 0;
for (const a of accounts) {
  const r = await rawCall("DELETE", `/accounts/${a._id}`);
  if (r.status >= 300) { failed++; console.error(`  ${a._id}: ${r.status} ${r.text.slice(0, 120)}`); }
}

const after = await rawCall("GET", "/accounts");
const left = after.status === 200 ? (JSON.parse(after.text) as unknown[]).length : `unknown (${after.status})`;
console.log(`Done: ${accounts.length - failed} deleted, ${failed} failed, ${left} accounts left. Customers cannot be deleted in this Nessie.`);
process.exit(failed ? 1 : 0);
