import { config } from "../config.js";

const today = () => new Date().toISOString().slice(0, 10);

/** One request, returning the status and the raw body text. The key is sent as `?key=`, never logged. */
export async function rawCall(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const url = `${config.nessie.base}${path}${path.includes("?") ? "&" : "?"}key=${config.nessie.key}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, text } = await rawCall(method, path, body);
  if (status < 200 || status >= 300) throw new Error(`Nessie ${method} ${path} -> ${status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type Created = { objectCreated?: { _id: string } };
const idOf = (r: Created) => {
  const id = r.objectCreated?._id;
  if (!id) throw new Error("Nessie: no _id in response " + JSON.stringify(r).slice(0, 200));
  return id;
};

export const customerBody = (first: string, last: string) => ({
  first_name: first, last_name: last,
  address: { street_number: "100", street_name: "Franklin St", city: "Chapel Hill", state: "NC", zip: "27514" },
});
export const accountBody = (nickname: string, balance: number) => ({ type: "Checking", nickname, rewards: 0, balance });
export const transferBody = (toAccountId: string, amount: number, description: string) => ({
  medium: "balance", payee_id: toAccountId, amount, transaction_date: today(), description,
});
export const withdrawalBody = (amount: number, description: string) => ({
  medium: "balance", amount, transaction_date: today(), description,
});

export const nessie = {
  async createCustomer(first: string, last: string): Promise<string> {
    return idOf(await call<Created>("POST", "/customers", customerBody(first, last)));
  },
  async createAccount(customerId: string, nickname: string, balance: number): Promise<string> {
    return idOf(await call<Created>("POST", `/customers/${customerId}/accounts`, accountBody(nickname, balance)));
  },
  async transfer(fromAccountId: string, toAccountId: string, amount: number, description: string): Promise<string> {
    return idOf(await call<Created>("POST", `/accounts/${fromAccountId}/transfers`, transferBody(toAccountId, amount, description)));
  },
  async withdraw(accountId: string, amount: number, description: string): Promise<string> {
    return idOf(await call<Created>("POST", `/accounts/${accountId}/withdrawals`, withdrawalBody(amount, description)));
  },
  getAccount: (id: string) => call<{ balance: number; nickname: string }>("GET", `/accounts/${id}`),
  listTransfers: (id: string, type: "payer" | "payee") => call<unknown[]>("GET", `/accounts/${id}/transfers?type=${type}`),
  deleteAll: (type: "Customers" | "Accounts" | "Transfers" | "Withdrawals") => call("DELETE", `/data?type=${type}`),
};
