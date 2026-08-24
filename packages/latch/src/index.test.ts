import assert from "node:assert/strict";
import { test } from "node:test";
import { createProvenance, ProvenanceError } from "./index.js";

test("blocks model-invented email on send_email", () => {
  const { store, gate } = createProvenance();
  gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  });

  const invented = store.fromModel("ceo@evil.example");
  assert.throws(
    () => gate.check("send_email", { to: invented, body: "hi" }),
    (e: unknown) => e instanceof ProvenanceError,
  );
});

test("allows user-grounded email", () => {
  const { store, gate } = createProvenance();
  gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  });

  const to = store.fromUser("alice@acme.com", "utterance:1");
  const plain = gate.check("send_email", { to, body: "hi" });
  assert.equal(plain.to, "alice@acme.com");
});

test("derived from user stays grounded", () => {
  const { store, gate } = createProvenance();
  gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  });

  const raw = store.fromUser("  Alice@Acme.com ", "utterance:1");
  const to = store.derive(raw.value.trim().toLowerCase(), [raw], "normalize_email");
  const plain = gate.check("send_email", { to });
  assert.equal(plain.to, "alice@acme.com");
});

test("unsealed plain value is treated as model-tainted", () => {
  const { gate } = createProvenance();
  gate.policy({
    tool: "delete_file",
    args: [{ path: "path", allow: ["user", "tool"] }],
  });
  assert.throws(() => gate.check("delete_file", { path: "/etc/passwd" }));
});

test("tool-grounded id allowed", () => {
  const { store, gate } = createProvenance();
  gate.policy({
    tool: "refund",
    args: [{ path: "chargeId", allow: ["tool"] }],
  });
  const chargeId = store.fromTool("ch_123", "stripe.list", "call_9");
  const plain = gate.check("refund", { chargeId });
  assert.equal(plain.chargeId, "ch_123");
});
