import assert from "node:assert/strict";
import { test } from "node:test";
import { createWitnessStore } from "./index.js";

test("ttl witness marks stale after expiry", async () => {
  const store = createWitnessStore();
  const rec = await store.put("temp code is 1234", { type: "ttl", ms: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const used = await store.use(rec.id);
  assert.equal(used.status, "stale");
  assert.equal(used.usable, false);
});

test("eq witness detects employer change", async () => {
  let employer = "Google";
  const store = createWitnessStore();
  const rec = await store.put("User works at Google", {
    type: "eq",
    read: () => employer,
    expect: "Google",
  });

  let used = await store.use(rec.id);
  assert.equal(used.usable, true);

  employer = "Anthropic";
  used = await store.use(rec.id);
  assert.equal(used.status, "stale");
  assert.equal(used.usable, false);
});

test("promptBlock never injects stale as fact", async () => {
  let v = 1;
  const store = createWitnessStore();
  const a = await store.put("works at Google", {
    type: "version",
    read: () => v,
  });
  const b = await store.put("prefers dark mode", { type: "ttl", ms: 60_000 });

  v = 2;
  const block = await store.promptBlock([a.id, b.id]);
  assert.deepEqual(block.facts, ["prefers dark mode"]);
  assert.equal(block.warnings.length, 1);
  assert.match(block.warnings[0]!, /stale/);
});

test("check failure → unverifiable when throw", async () => {
  const store = createWitnessStore();
  const rec = await store.put("secret", {
    type: "check",
    run: () => {
      throw new Error("network down");
    },
  });
  const used = await store.use(rec.id);
  assert.equal(used.status, "unverifiable");
  assert.equal(used.usable, false);
});
