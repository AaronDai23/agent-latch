/**
 * Stack: latch (provenance) → approval (exact payload) → budget (spend cap).
 * Invented recipient blocked; unapproved refund blocked; drifted amount blocked;
 * overspend blocked; only grounded + approved + in-budget call runs.
 */
import {
  createLatch,
  wrapTools,
} from "../../packages/latch/src/index.js";
import { createApproval, wrapApproval } from "../../packages/approval/src/index.js";
import { createBudget, wrapBudget } from "../../packages/budget/src/index.js";

const latch = createLatch();
latch.gate.policy({
  tool: "refund",
  args: [{ path: "chargeId", allow: ["user", "tool"] }],
});

const approval = createApproval();
const budget = createBudget({
  limits: [{ id: "refund_spend", kind: "usd_cents", max: 50, tool: "refund" }],
});

const ledger: string[] = [];

const raw = {
  refund: async (args: Record<string, unknown>) => {
    const line = `refund ${args.amount} on ${args.chargeId}`;
    ledger.push(line);
    return { ok: true, line };
  },
};

const withBudget = wrapBudget(budget, raw, {
  estimate: (_t, args) => ({
    calls: 1,
    usdCents: Number(args.amount ?? 0),
  }),
  onDenied: (err) => ({
    ok: false,
    error_kind: "budget",
    error: err.message,
    limit: err.detail.limitId,
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

const userMessage = "Please refund charge ch_user_1 for $10";
latch.store.fromUser("ch_user_1", "msg-1");

console.log("=== latch + approval + budget ===\n");
console.log("User:", userMessage, "\n");

console.log("1) Invented charge id → provenance deny");
console.log(
  " ",
  await tools.refund!({ chargeId: "ch_invented", amount: 10 }),
);

console.log("\n2) Grounded id, no approval yet → needs_approval");
const pending = (await tools.refund!({
  chargeId: "ch_user_1",
  amount: 10,
})) as { ticketId?: string; error_kind?: string };
console.log(" ", pending);

if (pending.ticketId) {
  console.log("\n3) Human approves $10 snapshot");
  approval.approve(pending.ticketId, { by: "ops@acme.com" });

  console.log("\n4) Drift to $999 → approval deny");
  console.log(
    " ",
    await tools.refund!({
      chargeId: "ch_user_1",
      amount: 999,
      ticketId: pending.ticketId,
    }),
  );

  console.log("\n5) Matching $10 → executes (within budget)");
  console.log(
    " ",
    await tools.refund!({
      chargeId: "ch_user_1",
      amount: 10,
      ticketId: pending.ticketId,
    }),
  );
}

console.log("\nLedger:", ledger);
console.log("\n--- latch ---");
latch.audit.print();
console.log("\n--- approval ---");
approval.print();
console.log("\n--- budget ---");
budget.print();

console.log(
  "\nOK — provenance, approval integrity, and budget all gated the write path.",
);
