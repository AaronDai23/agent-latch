/**
 * Failure suite — the recommendable number.
 *
 * 100 model-invented recipients:
 *   without latch → 100 sends
 *   with latch    → 0 sends
 */
import { createLatch, ProvenanceError } from "../src/index.js";

const N = 100;
const invented = Array.from({ length: N }, (_, i) => `victim${i}@not-real.example`);

let without = 0;
for (const to of invented) {
  without += 1; // naïve agent trusts the model
  void to;
}

const { store, gate } = createLatch();
gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

let withLatch = 0;
let blocked = 0;
for (const to of invented) {
  try {
    gate.check("send_email", { to: store.fromModel(to) });
    withLatch += 1;
  } catch (e) {
    if (e instanceof ProvenanceError) blocked += 1;
    else throw e;
  }
}

// Control: user-grounded must still pass
gate.check("send_email", { to: store.fromUser("alice@acme.com", "u1") });

console.log("=== latch — bench ===\n");
console.log(`Invented recipients:     ${N}`);
console.log(`Sends without latch:     ${without}`);
console.log(`Sends with latch:        ${withLatch}`);
console.log(`Blocked by latch:        ${blocked}`);
console.log(`Escape rate with latch:  ${((withLatch / N) * 100).toFixed(1)}%`);

if (withLatch !== 0 || blocked !== N) {
  console.error("\nFAIL — latch leaked invented recipients");
  process.exit(1);
}
console.log("\nPASS — 0 escapes. This is the number you quote.");
