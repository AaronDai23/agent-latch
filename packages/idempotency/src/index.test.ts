import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FileClaimStore,
  IdempotencyError,
  MemoryRedisEvalClient,
  RedisClaimStore,
  createIdempotency,
  injectIdempotencyKey,
  intentKey,
  wrapIdempotency,
} from "./index.js";

test("same args retry replays committed result", async () => {
  const idem = createIdempotency({ mode: "dev" });
  let hits = 0;
  const tools = wrapIdempotency(idem, {
    charge: async (args) => {
      hits++;
      return { chargeId: `ch_${hits}`, amount: args.amount, key: args.idempotencyKey };
    },
  });

  const first = (await tools.charge!({ amount: 10, customer: "a" })) as {
    key: string;
  };
  const second = await tools.charge!({ amount: 10, customer: "a" });
  assert.deepEqual(first, second);
  assert.equal(hits, 1);
  assert.ok(typeof first.key === "string" && first.key.length > 0);
  assert.equal(idem.log.list({ decision: "replay" }).length, 1);
});

test("injects idempotencyKey into downstream tool args", async () => {
  const idem = createIdempotency({ mode: "dev" });
  let seen: Record<string, unknown> | undefined;
  const tools = wrapIdempotency(idem, {
    charge: async (args) => {
      seen = args;
      return { ok: true };
    },
  });
  await tools.charge!({ amount: 10 });
  assert.equal(typeof seen?.idempotencyKey, "string");
  assert.equal(seen?.idempotencyKey, seen?.idempotency_key);
});

test("explicit key reused with different payload is denied", async () => {
  const idem = createIdempotency({ mode: "dev" });
  await idem.begin("charge", { amount: 10 }, { key: "pay_1" });
  await assert.rejects(
    () => idem.begin("charge", { amount: 99 }, { key: "pay_1" }),
    (e: unknown) => {
      assert.ok(e instanceof IdempotencyError);
      assert.match(e.message, /different payload/);
      return true;
    },
  );
});

test("active lease blocks other workers", async () => {
  const store = createIdempotency({ mode: "dev", workerId: "w1", leaseMs: 60_000 }).store;
  const a = createIdempotency({ mode: "dev", store, workerId: "w1", leaseMs: 60_000 });
  const b = createIdempotency({ mode: "dev", store, workerId: "w2", leaseMs: 60_000 });
  await a.begin("charge", { amount: 10 });
  await assert.rejects(
    () => b.begin("charge", { amount: 10 }),
    (e: unknown) => {
      assert.ok(e instanceof IdempotencyError);
      assert.match(e.message, /leased by another worker/);
      return true;
    },
  );
});

test("finance mode refuses blind re-execute without reconcile", async () => {
  const idem = createIdempotency({ mode: "finance", leaseMs: 1, workerId: "w1" });
  const first = await idem.begin("charge", { amount: 10 });
  assert.equal(first.kind, "execute");
  const claim = (await idem.get(first.claim.key))!;
  // Force lease expiry
  claim.leaseUntil = Date.now() - 1;
  await idem.store.compareAndSet({ ...claim, version: claim.version }, claim.version);

  await assert.rejects(
    () => idem.begin("charge", { amount: 10 }),
    (e: unknown) => {
      assert.ok(e instanceof IdempotencyError);
      assert.match(e.message, /provide reconcile/);
      return true;
    },
  );
});

test("reconcile hit commits and replays without second side effect", async () => {
  const world = new Map<string, { chargeId: string }>();
  const idem = createIdempotency({
    mode: "finance",
    leaseMs: 60_000,
    reconcile: ({ key }) => {
      const hit = world.get(key);
      if (hit) return { status: "committed", result: hit };
      return { status: "not_found" };
    },
  });

  const began = await idem.begin("charge", { amount: 10 });
  assert.equal(began.kind, "execute");
  if (began.kind !== "execute") return;

  // Downstream succeeded; process crashed before local commit.
  world.set(began.claim.key, { chargeId: "ch_1" });
  await idem.markUnknown(began.claim.key, "process crashed");
  const c = (await idem.get(began.claim.key))!;
  assert.equal(c.status, "unknown");
  await idem.store.compareAndSet(
    { ...c, leaseUntil: Date.now() - 1, version: c.version },
    c.version,
  );

  let hits = 0;
  const tools = wrapIdempotency(idem, {
    charge: async () => {
      hits++;
      return { chargeId: "should_not_run" };
    },
  });

  const second = await tools.charge!({ amount: 10 });
  assert.deepEqual(second, { chargeId: "ch_1" });
  assert.equal(hits, 0);
  assert.equal(idem.log.list({ decision: "reconcile_hit" }).length, 1);
});

test("reconcile miss allows re-execute with same downstream key", async () => {
  const seenKeys: string[] = [];
  const idem = createIdempotency({
    mode: "finance",
    leaseMs: 1,
    reconcile: () => ({ status: "not_found" }),
  });

  const tools = wrapIdempotency(
    idem,
    {
      charge: async (args) => {
        seenKeys.push(String(args.idempotencyKey));
        if (seenKeys.length === 1) throw new Error("timeout after send?");
        return { ok: true };
      },
    },
    { classifyError: () => "unknown" },
  );

  await assert.rejects(async () => tools.charge!({ amount: 10 }));
  const c = (await idem.list({ status: "unknown" }))[0]!;
  await idem.store.compareAndSet(
    { ...c, leaseUntil: Date.now() - 1, version: c.version },
    c.version,
  );
  await tools.charge!({ amount: 10 });
  assert.equal(seenKeys.length, 2);
  assert.equal(seenKeys[0], seenKeys[1]);
});

test("file store survives process restart semantics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "idem-"));
  const path = join(dir, "claims.json");
  const store = new FileClaimStore(path);
  const a = createIdempotency({ mode: "dev", store, workerId: "w1" });
  const began = await a.begin("charge", { amount: 7 });
  assert.equal(began.kind, "execute");
  await a.commit(began.claim.key, { chargeId: "ch_file" });

  const b = createIdempotency({
    mode: "dev",
    store: new FileClaimStore(path),
    workerId: "w2",
  });
  const again = await b.begin("charge", { amount: 7 });
  assert.equal(again.kind, "replay");
  if (again.kind === "replay") {
    assert.deepEqual(again.result, { chargeId: "ch_file" });
  }
});

test("uncertain error marks unknown not failed", async () => {
  const idem = createIdempotency({ mode: "finance" });
  const tools = wrapIdempotency(idem, {
    charge: async () => {
      throw new Error("ECONNRESET");
    },
  });
  await assert.rejects(async () => tools.charge!({ amount: 1 }));
  const list = await idem.list({ status: "unknown" });
  assert.equal(list.length, 1);
});

test("intentKey order-independent; inject helper", () => {
  assert.equal(
    intentKey("charge", { a: 1, b: 2 }).key,
    intentKey("charge", { b: 2, a: 1 }).key,
  );
  const injected = injectIdempotencyKey({ amount: 1 }, "pay_x");
  assert.equal(injected.idempotencyKey, "pay_x");
  assert.equal(injected.amount, 1);
});

test("RedisClaimStore CAS works via injectable client", async () => {
  const redis = new MemoryRedisEvalClient();
  const store = new RedisClaimStore(redis, "test:idem:");
  const gate = createIdempotency({ mode: "dev", store, workerId: "rw1" });
  const began = await gate.begin("charge", { amount: 42 });
  assert.equal(began.kind, "execute");
  await gate.commit(began.claim.key, { chargeId: "ch_redis" });

  const gate2 = createIdempotency({ mode: "dev", store, workerId: "rw2" });
  const again = await gate2.begin("charge", { amount: 42 });
  assert.equal(again.kind, "replay");
  if (again.kind === "replay") {
    assert.deepEqual(again.result, { chargeId: "ch_redis" });
  }

  const conflict = await store.compareAndSet(
    { ...(await store.get(began.claim.key))!, version: 999 },
    0,
  );
  assert.equal(conflict, false);
});
