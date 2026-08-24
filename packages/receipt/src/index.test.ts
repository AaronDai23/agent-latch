import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifacts,
  createReceipt,
  ReceiptError,
  wrapReceipt,
} from "./index.js";

test("settle ok when verify passes", async () => {
  const world = new Set<string>(["msg_1"]);
  const receipt = createReceipt([
    {
      tool: "send_email",
      artifact: artifacts.field("messageId"),
      verify: ({ artifact }) => !!artifact && world.has(artifact),
    },
  ]);

  const env = await receipt.settle(
    "send_email",
    { to: "a@b.c" },
    { messageId: "msg_1", sent: true },
  );
  assert.equal(env.ok, true);
  assert.equal(env.verified, true);
  assert.equal(env.artifact, "msg_1");
  assert.equal(env.data?.messageId, "msg_1");
});

test("settle fails when HTTP-looking success but world missing", async () => {
  const world = new Set<string>();
  const receipt = createReceipt([
    {
      tool: "send_email",
      artifact: artifacts.field("messageId"),
      verify: ({ artifact }) => !!artifact && world.has(artifact),
    },
  ]);

  await assert.rejects(
    () =>
      receipt.settle("send_email", { to: "board@x.com" }, { messageId: "msg_fake", sent: true }),
    (e: unknown) => e instanceof ReceiptError,
  );
});

test("soft settle returns envelope without throw", async () => {
  const receipt = createReceipt([
    {
      tool: "send_email",
      artifact: () => "x",
      verify: () => false,
    },
  ]);
  const env = await receipt.settle("send_email", {}, { ok: true }, { soft: true });
  assert.equal(env.ok, false);
  assert.equal(env.error_kind, "verify_failed");
  assert.equal(env.data, null);
});

test("wrapReceipt returns envelope; blocks fake success", async () => {
  const delivered = new Set<string>();
  const receipt = createReceipt([
    {
      tool: "send_email",
      artifact: artifacts.field("messageId"),
      verify: async ({ artifact }) => !!artifact && delivered.has(artifact),
    },
  ]);

  const tools = wrapReceipt(
    receipt,
    {
      send_email: (args) => {
        // Fake SMTP: returns 200-shaped body but never delivers
        return { sent: true, messageId: `msg_${String(args.to)}`, status: 200 };
      },
    },
    { soft: true },
  );

  const env = (await tools.send_email!({ to: "board@acme.com" })) as {
    ok: boolean;
    error_kind?: string;
  };
  assert.equal(env.ok, false);
  assert.equal(env.error_kind, "verify_failed");
});

test("wrapReceipt ok when deliver + verify", async () => {
  const delivered = new Set<string>();
  const receipt = createReceipt([
    {
      tool: "send_email",
      artifact: artifacts.field("messageId"),
      verify: async ({ artifact }) => !!artifact && delivered.has(artifact),
    },
  ]);

  const tools = wrapReceipt(receipt, {
    send_email: (args) => {
      const messageId = `msg_${Date.now()}`;
      delivered.add(messageId); // real side effect
      return { sent: true, messageId, to: args.to };
    },
  });

  const env = (await tools.send_email!({ to: "alice@acme.com" })) as {
    ok: boolean;
    artifact: string;
  };
  assert.equal(env.ok, true);
  assert.ok(env.artifact.startsWith("msg_"));
});

test("reconcile detects later mismatch", async () => {
  const world = new Set<string>(["ch_1"]);
  const receipt = createReceipt([
    {
      tool: "charge",
      artifact: artifacts.field("chargeId"),
      verify: ({ artifact }) => !!artifact && world.has(artifact),
    },
  ]);

  await receipt.settle("charge", { amount: 10 }, { chargeId: "ch_1" });
  world.delete("ch_1"); // charge reversed / never committed

  const env = await receipt.reconcile("charge", { amount: 10 }, { chargeId: "ch_1" }, {
    artifact: "ch_1",
  });
  assert.equal(env.ok, false);
  assert.equal(receipt.log.summary().mismatch, 1);
});

test("envelope: data null when not ok", async () => {
  const receipt = createReceipt([
    {
      tool: "write",
      artifact: () => "id",
      verify: () => false,
    },
  ]);
  const env = await receipt.settle("write", {}, { id: "id" }, { soft: true });
  assert.equal(env.data, null);
  assert.equal(env.ok, false);
});

test("log print and summary", async () => {
  const receipt = createReceipt([
    {
      tool: "t",
      verify: () => true,
      artifact: () => "a",
    },
  ]);
  await receipt.settle("t", {}, {});
  assert.match(receipt.log.print(), /1 ok/);
  assert.equal(receipt.log.summary().ok, 1);
});
