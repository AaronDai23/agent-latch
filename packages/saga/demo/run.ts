/**
 * Demo: charge + ship; ship fails → charge is refunded automatically.
 * Email already sent → mitigated (apology), never pretended undelivered.
 */
import { createSaga } from "../src/index.js";

const world = { charged: 0, shipped: false, emails: [] as string[], notes: [] as string[] };

const saga = createSaga();

saga
  .register({
    name: "charge",
    reversibility: "compensatable",
    execute: (args: { amount: number }) => {
      world.charged += args.amount;
      return { chargeId: "ch_1", amount: args.amount };
    },
    compensate: (args) => {
      world.charged -= args.amount as number;
    },
  })
  .register({
    name: "notify",
    reversibility: "irreversible",
    execute: (args: { to: string }) => {
      world.emails.push(args.to);
      return { id: "mail_1" };
    },
    mitigate: (args, _r, reason) => {
      const note = `follow-up to ${args.to}: prior mail may be wrong (${reason})`;
      world.notes.push(note);
      return note;
    },
  })
  .register({
    name: "ship",
    reversibility: "compensatable",
    execute: () => {
      throw new Error("warehouse offline");
    },
    compensate: () => {
      world.shipped = false;
    },
  });

console.log("=== latch-saga ===\n");

try {
  await saga.run(async (tx) => {
    await tx.call("charge", { amount: 99 });
    await tx.call("notify", { to: "buyer@acme.com" });
    await tx.call("ship", { orderId: "o1" });
  });
} catch (e) {
  console.log("Saga failed:", (e as Error).message);
}

console.log("\nWorld after automatic rollback:");
console.log(" ", world);
console.log("\nEffect log:");
for (const r of saga.log.records) {
  console.log(`  ${r.tool.padEnd(8)} ${r.status}${r.mitigation ? ` — ${r.mitigation}` : ""}`);
}

console.log("\nOK — partial side effects leave a coherent world + honest ledger.");
