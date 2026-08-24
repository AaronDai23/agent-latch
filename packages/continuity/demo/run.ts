/**
 * Demo: two workers propose from the same head — only the first commit wins.
 * Privilege self-injection via patch is ignored; authority lives only in the kernel.
 */
import { createKernel } from "../src/index.js";

const k = createKernel().grant("operator");
const h0 = k.openBranch("agent-1", { plan: "idle", memory: [] as string[] });

console.log("=== latch-continuity ===\n");
console.log("Head0:", h0.id, h0.state);

const workerA = k.propose({
  branch: "agent-1",
  predecessor: h0.id,
  patch: { plan: "email Alice", memory: ["user asked to email Alice"] },
  requires: ["operator"],
  note: "worker A",
});

const workerB = k.propose({
  branch: "agent-1",
  predecessor: h0.id,
  patch: { plan: "email Board", memory: ["model invented Board"] },
  requires: ["operator"],
  note: "stale retry / concurrent worker",
});

console.log("\nCommit A:", k.commit(workerA));
console.log("Commit B (stale):", k.commit(workerB));
console.log("Authoritative head:", k.head("agent-1")?.state);

const escalator = k.propose({
  branch: "agent-1",
  predecessor: k.head("agent-1")!.id,
  patch: { plan: "wipe_db", __authorities: ["root"] },
  requires: ["root"],
  note: "model tries to self-authorize",
});
console.log("\nSelf-authorize attempt:", k.commit(escalator));

console.log("\nLineage receipts:");
for (const h of k.lineage("agent-1")) {
  console.log(`  seq=${h.seq} receipt=${h.receipt} plan=${h.state.plan}`);
}

console.log("\nOK — proposers think; only the kernel activates.");
