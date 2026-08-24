/**
 * Demo: agent loop burns call budget → blocked.
 * Money meter stops a second expensive charge.
 */
import { createBudget, wrapBudget } from "../src/index.js";

const budget = createBudget({
  limits: [
    { id: "lookups", kind: "calls", max: 3, tool: "lookup" },
    { id: "spend", kind: "usd_cents", max: 100, tool: "charge" },
  ],
});

const world = { charges: [] as number[], lookups: 0 };

const tools = wrapBudget(
  budget,
  {
    lookup: async () => {
      world.lookups++;
      return { rows: world.lookups };
    },
    charge: async (args) => {
      const amount = Number(args.amount ?? 0);
      world.charges.push(amount);
      return { ok: true, amount };
    },
  },
  {
    estimate: (tool, args) => {
      if (tool === "charge") {
        return { calls: 1, usdCents: Number(args.amount ?? 0) };
      }
      return { calls: 1 };
    },
    onDenied: (err) => ({
      error: "budget_exceeded",
      limit: err.detail.limitId,
      used: err.detail.used,
      max: err.detail.max,
    }),
  },
);

console.log("=== agent-latch-budget ===\n");

for (let i = 0; i < 5; i++) {
  const r = await tools.lookup!({});
  console.log(`lookup #${i + 1} →`, r);
}

console.log("\ncharge $0.60 then $0.60 (cap $1.00):");
console.log(" ", await tools.charge!({ amount: 60 }));
console.log(" ", await tools.charge!({ amount: 60 }));

console.log("\nMeters:");
for (const m of budget.meters()) {
  console.log(`  ${m.id.padEnd(8)} ${m.used}/${m.max} ${m.kind}`);
}

console.log("\n--- audit ---");
budget.print();

console.log("\nOK — runaway lookups and overspend blocked at the gate.");
