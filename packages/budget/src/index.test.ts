import assert from "node:assert/strict";
import { test } from "node:test";
import { BudgetError, createBudget, wrapBudget } from "./index.js";

test("denies when call budget would exceed", () => {
  const budget = createBudget({
    limits: [{ id: "calls", kind: "calls", max: 2 }],
  });

  budget.authorize("ping", {});
  budget.authorize("ping", {});
  assert.equal(budget.usage("calls"), 2);
  assert.throws(() => budget.authorize("ping", {}), (e: unknown) => {
    assert.ok(e instanceof BudgetError);
    assert.equal(e.detail.limitId, "calls");
    return true;
  });
});

test("tool-scoped limit does not block other tools", () => {
  const budget = createBudget({
    limits: [{ id: "email", kind: "calls", max: 1, tool: "send_email" }],
  });

  budget.authorize("send_email", { to: "a@b.c" });
  budget.authorize("lookup", { q: "x" });
  assert.throws(() => budget.authorize("send_email", { to: "c@d.e" }));
  assert.equal(budget.usage("email"), 1);
});

test("usd_cents meter tracks spend", () => {
  const budget = createBudget({
    limits: [{ id: "spend", kind: "usd_cents", max: 100 }],
    defaultDelta: { calls: 1, usdCents: 40 },
  });

  budget.authorize("charge", { amount: 40 }, { usdCents: 40 });
  budget.authorize("charge", { amount: 40 }, { usdCents: 40 });
  assert.throws(() =>
    budget.authorize("charge", { amount: 40 }, { usdCents: 40 }),
  );
  assert.equal(budget.usage("spend"), 80);
});

test("warn onBreach records warn but does not throw", () => {
  const budget = createBudget({
    limits: [{ id: "soft", kind: "calls", max: 0, onBreach: "warn" }],
  });
  const { warnings } = budget.check("x", {}, { calls: 1 });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.decision, "warn");
});

test("wrapBudget blocks runaway loop", async () => {
  const budget = createBudget({
    limits: [{ id: "api", kind: "calls", max: 3 }],
  });
  let hits = 0;
  const tools = wrapBudget(budget, {
    hit: async () => {
      hits++;
      return { ok: true };
    },
  });

  await tools.hit!({});
  await tools.hit!({});
  await tools.hit!({});
  await assert.rejects(async () => tools.hit!({}));
  assert.equal(hits, 3);
});

test("wrapBudget onDenied soft-fails", async () => {
  const budget = createBudget({
    limits: [{ id: "api", kind: "calls", max: 0 }],
  });
  const tools = wrapBudget(
    budget,
    { hit: async () => ({ ok: true }) },
    {
      onDenied: (err) => ({ error: "budget", limit: err.detail.limitId }),
    },
  );
  const out = await tools.hit!({});
  assert.deepEqual(out, { error: "budget", limit: "api" });
});

test("reset clears meters", () => {
  const budget = createBudget({
    limits: [{ id: "calls", kind: "calls", max: 1 }],
  });
  budget.authorize("a", {});
  budget.reset();
  budget.authorize("a", {});
  assert.equal(budget.usage("calls"), 1);
});
