import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaga, EffectLog } from "./index.js";

test("LIFO compensate on failure", async () => {
  const events: string[] = [];
  const saga = createSaga();

  saga
    .register({
      name: "reserve",
      reversibility: "compensatable",
      execute: (args) => {
        events.push(`reserve:${args.item}`);
        return { ok: true };
      },
      compensate: (args) => {
        events.push(`unreserve:${args.item}`);
      },
    })
    .register({
      name: "charge",
      reversibility: "compensatable",
      execute: (args) => {
        events.push(`charge:${args.amount}`);
        return { chargeId: "c1" };
      },
      compensate: (args) => {
        events.push(`refund:${args.amount}`);
      },
    })
    .register({
      name: "ship",
      reversibility: "compensatable",
      execute: () => {
        events.push("ship");
        throw new Error("carrier down");
      },
      compensate: () => {
        events.push("unship");
      },
    });

  await assert.rejects(() =>
    saga.run(async (tx) => {
      await tx.call("reserve", { item: "sku-1" });
      await tx.call("charge", { amount: 42 });
      await tx.call("ship", { item: "sku-1" });
    }),
  );

  assert.deepEqual(events, [
    "reserve:sku-1",
    "charge:42",
    "ship",
    "refund:42",
    "unreserve:sku-1",
  ]);

  const statuses = saga.log.records.map((r) => r.status);
  assert.ok(statuses.includes("compensated"));
  assert.ok(statuses.includes("failed"));
});

test("irreversible uses mitigate, not fake undo", async () => {
  const saga = createSaga();
  let mitigation = "";

  saga
    .register({
      name: "send_email",
      reversibility: "irreversible",
      execute: () => ({ messageId: "m1" }),
      mitigate: (_a, _r, reason) => {
        mitigation = `apology sent because ${reason}`;
        return mitigation;
      },
    })
    .register({
      name: "fail",
      reversibility: "compensatable",
      execute: () => {
        throw new Error("boom");
      },
      compensate: () => {},
    });

  await assert.rejects(() =>
    saga.run(async (tx) => {
      await tx.call("send_email", { to: "a@b.c" });
      await tx.call("fail", {});
    }),
  );

  const email = saga.log.records.find((r) => r.tool === "send_email");
  assert.equal(email?.status, "mitigated");
  assert.match(mitigation, /apology/);
});

test("ahead-of-log writes intent before execute", async () => {
  const log = new EffectLog();
  const saga = createSaga(log);
  let sawIntent = false;

  saga.register({
    name: "write",
    reversibility: "compensatable",
    execute: () => {
      sawIntent = log.records.some((r) => r.status === "intent");
      return true;
    },
    compensate: () => {},
  });

  await saga.run(async (tx) => {
    await tx.call("write", { x: 1 });
  });

  assert.equal(sawIntent, true);
  assert.equal(log.records[0]?.status, "done");
});
