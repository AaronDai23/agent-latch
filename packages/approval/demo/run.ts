/**
 * Demo: human approves refund $10; agent retries with $999 → drift denied.
 * Matching redeem after approval → executes once.
 */
import { createApproval, wrapApproval } from "../src/index.js";

const approval = createApproval();
const ledger: string[] = [];

const tools = wrapApproval(
  approval,
  {
    refund: async (args) => {
      const line = `refunded ${args.amount} on ${args.chargeId}`;
      ledger.push(line);
      return { ok: true, line };
    },
  },
  {
    onDenied: (err) => ({
      ok: false,
      error_kind: "approval",
      error: err.message,
      detail: err.detail,
    }),
  },
);

console.log("=== agent-latch-approval ===\n");

console.log("1) First call without ticket → needs approval");
const pending = (await tools.refund!({
  chargeId: "ch_1",
  amount: 10,
})) as { ticketId: string; hash: string; snapshot: unknown };
console.log(" ", pending);

console.log("\n2) Human approves exact snapshot");
approval.approve(pending.ticketId, { by: "ops@acme.com" });
console.log("  approved", pending.ticketId, "hash=", pending.hash);

console.log("\n3) Agent retries with drifted amount → blocked");
const drifted = await tools.refund!({
  chargeId: "ch_1",
  amount: 999,
  ticketId: pending.ticketId,
});
console.log(" ", drifted);

console.log("\n4) Agent retries with approved payload → executes");
// Need a fresh ticket because drift attempt did not consume; ticket still approved.
const ok = await tools.refund!({
  chargeId: "ch_1",
  amount: 10,
  ticketId: pending.ticketId,
});
console.log(" ", ok);

console.log("\nLedger:", ledger);
console.log("\n--- audit ---");
approval.print();

console.log("\nOK — approval binds to payload; drift cannot execute.");
