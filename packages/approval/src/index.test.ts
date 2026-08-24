import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApprovalError,
  createApproval,
  payloadHash,
  wrapApproval,
} from "./index.js";

test("approve then redeem matching payload", () => {
  const approval = createApproval();
  const ticket = approval.propose("refund", { chargeId: "ch_1", amount: 10 });
  assert.equal(ticket.status, "pending");
  approval.approve(ticket.id, { by: "ops@acme.com" });
  const used = approval.redeem(ticket.id, "refund", {
    chargeId: "ch_1",
    amount: 10,
  });
  assert.equal(used.status, "used");
});

test("drift after approval is denied", () => {
  const approval = createApproval();
  const ticket = approval.propose("refund", { chargeId: "ch_1", amount: 10 });
  approval.approve(ticket.id, { by: "ops@acme.com" });
  assert.throws(
    () =>
      approval.redeem(ticket.id, "refund", {
        chargeId: "ch_1",
        amount: 999,
      }),
    (e: unknown) => {
      assert.ok(e instanceof ApprovalError);
      assert.match(e.message, /drift/i);
      return true;
    },
  );
  assert.equal(approval.log.list({ decision: "drift" }).length, 1);
});

test("payloadHash is order-independent", () => {
  assert.equal(
    payloadHash({ a: 1, b: 2 }),
    payloadHash({ b: 2, a: 1 }),
  );
});

test("cannot redeem pending ticket", () => {
  const approval = createApproval();
  const ticket = approval.propose("send_email", { to: "a@b.c" });
  assert.throws(() => approval.redeem(ticket.id, "send_email", { to: "a@b.c" }));
});

test("ticket is single-use", () => {
  const approval = createApproval();
  const ticket = approval.propose("refund", { chargeId: "ch_1", amount: 10 });
  approval.approve(ticket.id, { by: "ops" });
  approval.redeem(ticket.id, "refund", { chargeId: "ch_1", amount: 10 });
  assert.throws(() =>
    approval.redeem(ticket.id, "refund", { chargeId: "ch_1", amount: 10 }),
  );
});

test("wrapApproval proposes when no ticket", async () => {
  let ran = false;
  const approval = createApproval();
  const tools = wrapApproval(approval, {
    refund: async () => {
      ran = true;
      return { ok: true };
    },
  });

  const out = (await tools.refund!({ chargeId: "ch_1", amount: 10 })) as {
    ok: boolean;
    error_kind: string;
    ticketId: string;
  };
  assert.equal(out.ok, false);
  assert.equal(out.error_kind, "needs_approval");
  assert.equal(ran, false);
  assert.ok(out.ticketId);
});

test("wrapApproval executes after approve + ticketId", async () => {
  const approval = createApproval();
  const tools = wrapApproval(approval, {
    refund: async (args) => ({ refunded: args.amount }),
  });

  const first = (await tools.refund!({ chargeId: "ch_1", amount: 10 })) as {
    ticketId: string;
  };
  approval.approve(first.ticketId, { by: "ops@acme.com" });

  const second = await tools.refund!({
    chargeId: "ch_1",
    amount: 10,
    ticketId: first.ticketId,
  });
  assert.deepEqual(second, { refunded: 10 });
});

test("wrapApproval blocks drifted retry", async () => {
  const approval = createApproval();
  const tools = wrapApproval(
    approval,
    { refund: async () => ({ ok: true }) },
    {
      onDenied: (err) => ({ error: "blocked", message: err.message }),
    },
  );

  const first = (await tools.refund!({ chargeId: "ch_1", amount: 10 })) as {
    ticketId: string;
  };
  approval.approve(first.ticketId, { by: "ops" });

  const drifted = await tools.refund!({
    chargeId: "ch_1",
    amount: 500,
    ticketId: first.ticketId,
  });
  assert.equal((drifted as { error: string }).error, "blocked");
});
