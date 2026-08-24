/**
 * Aha demo — the story people retell.
 *
 * Without latch: the model invents board@acme.com and the email "sends".
 * With latch: same call is denied. User-grounded and CRM-grounded still work.
 */
import { createLatch, ProvenanceError } from "../src/index.js";

const sent: string[] = [];

function sendEmail(to: string, subject: string) {
  sent.push(to);
  return { ok: true, to, subject };
}

const { store, gate } = createLatch();
gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

function callSendEmail(args: Record<string, unknown>) {
  try {
    const plain = gate.check("send_email", args);
    return sendEmail(String(plain.to), String(plain.subject ?? ""));
  } catch (e) {
    if (e instanceof ProvenanceError) {
      return { ok: false as const, blocked: true, reason: e.message };
    }
    throw e;
  }
}

console.log("=== latch — aha ===\n");

console.log("1) User said “email Alice”");
console.log(
  "  ",
  callSendEmail({
    to: store.fromUser("alice@acme.com", "utterance:1"),
    subject: "Hello",
  }),
);

console.log("\n2) Model invents board@acme.com");
console.log(
  "  ",
  callSendEmail({
    to: store.fromModel("board@acme.com", "hallucinated"),
    subject: "Secret",
  }),
);

console.log("\n3) CRM lookup then send");
console.log(
  "  ",
  callSendEmail({
    to: store.fromTool("bob@acme.com", "crm.find_email", "call_42"),
    subject: "Hi Bob",
  }),
);

console.log("\n4) Unsealed plain string (treated as model)");
console.log("  ", callSendEmail({ to: "root@acme.com", subject: "oops" }));

console.log("\nActually delivered to:", sent);
console.log("OK — invented recipients never leave the machine.");
