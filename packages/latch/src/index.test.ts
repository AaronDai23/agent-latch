import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProvenance,
  groundFromUserMessage,
  latchTool,
  policies,
  ProvenanceError,
  sealFields,
  wrapTools,
} from "./index.js";

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

test("plain JSON arg matching prior fromUser passes (real tool-call shape)", () => {
  const { store, gate } = createProvenance();
  gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  });

  store.fromUser("alice@acme.com", "utterance:1");
  // Model emitted plain string in tool call JSON — same value user said
  const plain = gate.check("send_email", { to: "alice@acme.com", subject: "Hi" });
  assert.equal(plain.to, "alice@acme.com");
});

test("plain JSON invented arg still blocked", () => {
  const { store, gate } = createProvenance();
  gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  });
  store.fromUser("alice@acme.com", "utterance:1");
  assert.throws(() => gate.check("send_email", { to: "board@acme.com" }));
});

test("wrapTools drop-in blocks and allows", async () => {
  const latch = createProvenance();
  latch.gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  });
  latch.store.fromUser("alice@acme.com", "u1");

  const sent: string[] = [];
  const tools = wrapTools(
    latch,
    {
      send_email: (args) => {
        sent.push(String(args.to));
        return { ok: true };
      },
    },
    {
      onDenied: () => ({ ok: false, blocked: true }),
    },
  );

  assert.deepEqual(await tools.send_email!({ to: "alice@acme.com" }), { ok: true });
  assert.deepEqual(await tools.send_email!({ to: "evil@x.com" }), {
    ok: false,
    blocked: true,
  });
  assert.deepEqual(sent, ["alice@acme.com"]);
});

test("sealFields indexes CRM email for later send", () => {
  const { store, gate } = createProvenance();
  gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["tool"] }],
  });

  const row = sealFields(store, "crm.lookup", "c1", { email: "bob@acme.com", name: "Bob" }, [
    "email",
  ]);
  assert.equal(row.email, "bob@acme.com");
  const plain = gate.check("send_email", { to: "bob@acme.com" });
  assert.equal(plain.to, "bob@acme.com");
});

test("audit records allow and deny with path detail", () => {
  const { store, gate, audit } = createProvenance();
  gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  });
  store.fromUser("alice@acme.com", "u1");

  gate.check("send_email", { to: "alice@acme.com" });
  assert.throws(() => gate.check("send_email", { to: "evil@x.com" }));

  const summary = audit.summary();
  assert.equal(summary.allow, 1);
  assert.equal(summary.deny, 1);
  assert.equal(audit.list({ decision: "deny" })[0]?.paths[0]?.matched, "model");
  assert.match(audit.print(), /1 allow \/ 1 deny/);
});

test("groundFromUserMessage indexes emails from user text", () => {
  const { store, gate } = createProvenance();
  policies(gate, [
    { tool: "send_email", args: [{ path: "to", allow: ["user"] }] },
  ]);
  groundFromUserMessage(store, "Please email Alice@Acme.com thanks", "m1");
  gate.check("send_email", { to: "alice@acme.com" });
});

test("latchTool wraps single execute like AI SDK", async () => {
  const latch = createProvenance();
  latch.gate.policy({
    tool: "send_email",
    args: [{ path: "to", allow: ["user"] }],
  });
  latch.store.fromUser("a@b.c", "u1");
  const execute = latchTool(latch, "send_email", (args) => ({ ok: true, to: args.to }), {
    onDenied: () => ({ ok: false }),
  });
  assert.deepEqual(await execute({ to: "a@b.c" }), { ok: true, to: "a@b.c" });
  assert.deepEqual(await execute({ to: "x@y.z" }), { ok: false });
});
