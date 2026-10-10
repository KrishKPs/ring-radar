// Stage 1: one customer, two accounts, one transfer. Prints raw responses to check the VERIFY items in BUILD_GUIDE 10.1.
import { config } from "../src/config.js";
import { accountBody, customerBody, rawCall, transferBody } from "../src/nessie/client.js";

if (!config.nessie.key) {
  console.error("NESSIE_KEY is empty. Put it in .env first.");
  process.exit(1);
}

async function show(label: string, method: string, path: string, body?: unknown): Promise<any> {
  const start = Date.now();
  const { status, text } = await rawCall(method, path, body);
  console.log(`\n=== ${label}: ${method} ${path} -> ${status} (${Date.now() - start} ms)`);
  console.log(text);
  try { return JSON.parse(text); } catch { return null; }
}

// Pulls the new _id out of a create response; falls back to a top-level _id if the shape differs
const newId = (r: any): string | undefined => r?.objectCreated?._id ?? r?._id;

console.log(`Nessie base: ${config.nessie.base}`);

const customer = await show("create customer", "POST", "/customers", customerBody("Stage1", "Demo"));
const customerId = newId(customer);
if (!customerId) { console.error("\nNo customer _id found. Look at the response above."); process.exit(1); }

const a = await show("create account A ($5,000)", "POST", `/customers/${customerId}/accounts`, accountBody("Stage1 A", 5000));
const b = await show("create account B ($0, checks if 0 is accepted)", "POST", `/customers/${customerId}/accounts`, accountBody("Stage1 B", 0));
const aId = newId(a), bId = newId(b);
if (!aId || !bId) { console.error("\nMissing an account _id. Look at the responses above."); process.exit(1); }

await show("transfer A -> B $250", "POST", `/accounts/${aId}/transfers`, transferBody(bId, 250, "stage1 test transfer"));

await show("account A right after transfer", "GET", `/accounts/${aId}`);
await show("account B right after transfer", "GET", `/accounts/${bId}`);
await show("A transfers as payer", "GET", `/accounts/${aId}/transfers?type=payer`);

await new Promise(r => setTimeout(r, 5000));
await show("account A after 5 s", "GET", `/accounts/${aId}`);
await show("account B after 5 s", "GET", `/accounts/${bId}`);

console.log(`\nIDs: customer ${customerId}, A ${aId}, B ${bId}`);
