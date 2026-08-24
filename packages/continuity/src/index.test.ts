import assert from "node:assert/strict";
import { test } from "node:test";
import { createKernel } from "./index.js";

test("only commit advances head", () => {
  const k = createKernel();
  const h0 = k.openBranch("main", { step: 0 });
  const prop = k.propose({
    branch: "main",
    predecessor: h0.id,
    patch: { step: 1 },
  });
  assert.equal(k.head("main")?.seq, 0);
  const res = k.commit(prop);
  assert.equal(res.disposition, "accept");
  assert.equal(k.head("main")?.state.step, 1);
  assert.equal(k.head("main")?.seq, 1);
});

test("stale retry is rejected", () => {
  const k = createKernel();
  const h0 = k.openBranch("main", { n: 0 });
  const p1 = k.propose({ branch: "main", predecessor: h0.id, patch: { n: 1 } });
  const p2 = k.propose({ branch: "main", predecessor: h0.id, patch: { n: 99 } });
  assert.equal(k.commit(p1).disposition, "accept");
  const r2 = k.commit(p2);
  assert.equal(r2.disposition, "reject");
  assert.match(r2.reason, /stale predecessor/);
  assert.equal(k.head("main")?.state.n, 1);
});

test("missing authority rejects; cannot self-grant via patch", () => {
  const k = createKernel();
  const h0 = k.openBranch("main", {});
  const res = k.commit(
    k.propose({
      branch: "main",
      predecessor: h0.id,
      patch: { __authorities: ["admin"], role: "admin" },
      requires: ["admin"],
    }),
  );
  assert.equal(res.disposition, "reject");
  assert.match(res.reason, /missing authority/);

  k.grant("admin");
  const h = k.head("main")!;
  const ok = k.commit(
    k.propose({
      branch: "main",
      predecessor: h.id,
      patch: { role: "admin" },
      requires: ["admin"],
    }),
  );
  assert.equal(ok.disposition, "accept");
});

test("predicate evidence can defer or reject", () => {
  const k = createKernel();
  k.predicate("budget_ok", (_s, patch) => (patch.spend as number) <= 100);
  const h0 = k.openBranch("main", { spend: 0 });

  const defer = k.commit(
    k.propose({
      branch: "main",
      predecessor: h0.id,
      patch: { spend: 1 },
      evidence: [{ type: "predicate", name: "missing_pred" }],
    }),
  );
  assert.equal(defer.disposition, "defer");

  const bad = k.commit(
    k.propose({
      branch: "main",
      predecessor: h0.id,
      patch: { spend: 500 },
      evidence: [{ type: "predicate", name: "budget_ok" }],
    }),
  );
  assert.equal(bad.disposition, "reject");
});
