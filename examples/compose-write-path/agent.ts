/**
 * Recommended write-path stack (outer → inner on the call):
 *
 *   latch (provenance)
 *     → approval (exact payload)
 *       → budget (spend / call caps)
 *         → idempotency (claim before side effect)
 *           → receipt (verify world after)
 *             → raw tool
 *
 * Wrap order is reverse of that (innermost wrap first).
 *
 *   npm run example:compose
 */
import {
  createLatch,
  wrapTools,
} from "../../packages/latch/src/index.js";
import { createApproval, wrapApproval } from "../../packages/approval/src/index.js";
import { createBudget, wrapBudget } from "../../packages/budget/src/index.js";
import {
  createIdempotency,
  wrapIdempotency,
} from "../../packages/idempotency/src/index.js";
import {
  artifacts,
  createReceipt,
  wrapReceipt,
} from "../../packages/receipt/src/index.js";

const world = {
  charges: new Map<string, { chargeId: string; amount: number }>(),
  delivered: new Set<string>(),
};

const latch = createLatch();
latch.gate.policy({
  tool: "refund",
  args: [{ path: "chargeId", allow: ["user", "tool"] }],
});

const approval = createApproval();
const budget = createBudget({
  limits: [{ id: "refund_cents", kind: "usd_cents", max: 50, tool: "refund" }],
});
const idem = createIdempotency({
  mode: "finance",
  scope: "compose-demo",
  reconcile: ({ key }) => {
    const hit = world.charges.get(key);
    if (hit) return { status: "committed", result: hit };
    return { status: "not_found" };
  },
});
const receipt = createReceipt([
  {
    tool: "refund",
    artifact: artifacts.field("chargeId"),
    verify: ({ artifact }) => world.delivered.has(String(artifact)),
  },
]);

const raw = {
  refund: async (args: Record<string, unknown>) => {
    const key = String(args.idempotencyKey);
    const existing = world.charges.get(key);
    if (existing) {
      world.delivered.add(existing.chargeId);
      return existing;
    }
    const chargeId = `ch_${world.charges.size + 1}`;
    const row = { chargeId, amount: Number(args.amount) };
    world.charges.set(key, row);
    world.delivered.add(chargeId);
    return row;
  },
};

const withReceipt = wrapReceipt(receipt, raw, {
  onMismatch: (err) => ({
    ok: false,
    error_kind: "receipt",
    error: err.message,
  }),
});

const withIdem = wrapIdempotency(idem, withReceipt, {
  onReplay: (result, claim) => ({
    ok: true,
    replayed: true,
    key: claim.key,
    data: result,
  }),
  onDenied: (err) => ({
    ok: false,
    error_kind: "idempotency",
    error: err.message,
  }),
});

const withBudget = wrapBudget(budget, withIdem, {
  estimate: (_t, args) => ({
    calls: 1,
    usdCents: Number(args.amount ?? 0),
  }),
  onDenied: (err) => ({
    ok: false,
    error_kind: "budget",
    error: err.message,
  }),
});

const withApproval = wrapApproval(approval, withBudget, {
  onDenied: (err) => ({
    ok: false,
    error_kind: "approval",
    error: err.message,
  }),
});

const tools = wrapTools(latch, withApproval, {
  onDenied: (err) => ({
    ok: false,
    error_kind: "provenance",
    error: err.message,
  }),
});

latch.store.fromUser("ch_user_1", "msg-1");

console.log("=== compose write path ===\n");
console.log("Order: latch → approval → budget → idempotency → receipt → tool\n");

console.log("1) Invented chargeId → provenance deny");
console.log(" ", await tools.refund!({ chargeId: "ch_fake", amount: 10 }));

console.log("\n2) Grounded, no ticket → needs_approval");
const pending = (await tools.refund!({
  chargeId: "ch_user_1",
  amount: 10,
})) as { ticketId?: string };
console.log(" ", pending);

if (!pending.ticketId) {
  console.error("expected ticket");
  process.exit(1);
}

approval.approve(pending.ticketId, { by: "ops@acme.com" });

console.log("\n3) Drifted amount → approval deny");
console.log(
  " ",
  await tools.refund!({
    chargeId: "ch_user_1",
    amount: 999,
    ticketId: pending.ticketId,
  }),
);

console.log("\n4) Matching payload → execute once");
const first = await tools.refund!({
  chargeId: "ch_user_1",
  amount: 10,
  ticketId: pending.ticketId,
});
console.log(" ", first);

console.log(
  "\n5) Same intent retry at idempotency layer → replay",
);
console.log(
  "   (approval tickets are one-shot; durable claim covers agent/framework retries)",
);
console.log(
  " ",
  await withIdem.refund!({
    chargeId: "ch_user_1",
    amount: 10,
  }),
);

console.log("\nWorld charges:", world.charges.size, "delivered:", [...world.delivered]);
console.log("\nOK — five gates on one write path. See docs/COMPOSE.md");
