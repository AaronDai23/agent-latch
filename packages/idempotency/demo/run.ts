/**
 * Finance-safe demo:
 * 1) Charge with injected key
 * 2) Retry → replay
 * 3) Crash after Stripe success, before local commit → reconcile, no second charge
 */
import { createIdempotency, wrapIdempotency } from "../src/index.js";

const stripe = new Map<string, { chargeId: string; amount: number }>();

const idem = createIdempotency({
  mode: "finance",
  scope: "tenant_acme",
  leaseMs: 60_000,
  reconcile: ({ key }) => {
    const hit = stripe.get(key);
    if (hit) return { status: "committed", result: hit };
    return { status: "not_found" };
  },
});

const localLedger: string[] = [];

const tools = wrapIdempotency(
  idem,
  {
    charge: async (args) => {
      const key = String(args.idempotencyKey);
      const existing = stripe.get(key);
      if (existing) return existing;
      const receipt = {
        chargeId: `ch_${stripe.size + 1}`,
        amount: Number(args.amount),
      };
      stripe.set(key, receipt);
      localLedger.push(`charged ${receipt.amount} key=${key}`);
      return receipt;
    },
  },
  {
    onReplay: (result, claim) => ({
      ok: true,
      replayed: true,
      key: claim.key,
      data: result,
    }),
  },
);

console.log("=== agent-latch-idempotency (finance mode) ===\n");

console.log("1) First charge (key injected to Stripe)");
const first = await tools.charge!({ customer: "alice", amount: 10 });
console.log(" ", first);

console.log("\n2) Agent retry → local replay");
console.log(" ", await tools.charge!({ customer: "alice", amount: 10 }));

console.log("\n3) Simulate: Stripe ok, process dies before local commit");
const began = await idem.begin("refund", { amount: 3, customer: "bob" });
if (began.kind === "execute") {
  const key = began.claim.key;
  stripe.set(key, { chargeId: "ch_crash", amount: 3 });
  // never commit — crash
  await idem.markUnknown(key, "crashed after Stripe 200");
  const c = (await idem.get(key))!;
  await idem.store.compareAndSet(
    { ...c, leaseUntil: Date.now() - 1, version: c.version },
    c.version,
  );

  console.log("\n4) Retry after crash → reconcile hits Stripe (no new row)");
  const toolsRefund = wrapIdempotency(
    idem,
    {
      refund: async (args) => {
        localLedger.push(`SHOULD_NOT_RUN ${args.idempotencyKey}`);
        return { bad: true };
      },
    },
    {
      onReplay: (result, claim) => ({
        ok: true,
        replayed: true,
        key: claim.key,
        data: result,
      }),
    },
  );
  console.log(" ", await toolsRefund.refund!({ amount: 3, customer: "bob" }));
}

console.log("\nStripe rows:", [...stripe.entries()]);
console.log("Local mutating log:", localLedger);
console.log("\n--- audit ---");
idem.print();

console.log(
  "\nOK — finance mode: inject key + reconcile-before-retry; never blind reclaim.",
);
