/**
 * Demo: "works at Google" stays high-salience until the CRM changes —
 * use() then returns STALE instead of confidently wrong context.
 */
import { createWitnessStore } from "../src/index.js";

const crm = { employer: "Google" };
const store = createWitnessStore();

const job = await store.put(
  "User works at Google",
  {
    type: "eq",
    read: () => crm.employer,
    expect: "Google",
  },
  { field: "employer" },
);

const pref = await store.put("User prefers concise answers", {
  type: "ttl",
  ms: 24 * 60 * 60 * 1000,
});

console.log("=== latch-witness ===\n");

let block = await store.promptBlock([job.id, pref.id]);
console.log("1) Fresh world → facts:", block.facts);

crm.employer = "Anthropic";
block = await store.promptBlock([job.id, pref.id]);
console.log("\n2) After job change →");
console.log("   facts:   ", block.facts);
console.log("   warnings:", block.warnings);

const used = await store.use(job.id);
console.log("\n3) Direct use():", {
  usable: used.usable,
  status: used.status,
  detail: used.detail,
});

console.log("\nOK — stale high-salience memory can no longer poison the prompt.");
