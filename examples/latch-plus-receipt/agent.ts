/**
 * Latch + Receipt: provenance then outcome verification.
 *
 * 1) latch blocks model-invented recipients
 * 2) receipt rejects "sent:true" when SMTP never accepted the message
 */
import {
  createLatch,
  groundFromUserMessage,
  wrapTools,
} from "../../packages/latch/src/index.js";
import {
  artifacts,
  createReceipt,
  wrapReceipt,
} from "../../packages/receipt/src/index.js";

const smtp = { accepted: new Set<string>() };
const mailbox: string[] = [];

const latch = createLatch();
latch.gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

const receipt = createReceipt([
  {
    tool: "send_email",
    artifact: artifacts.field("messageId"),
    verify: ({ artifact }) => !!artifact && smtp.accepted.has(artifact),
  },
]);

function rawSend(args: Record<string, unknown>) {
  const to = String(args.to);
  const mode = String(args.mode ?? "real");
  if (mode === "fake") {
    // Looks successful, never hits SMTP
    return { sent: true, messageId: `fake_${to}`, status: 200 };
  }
  const messageId = `msg_${Date.now()}`;
  smtp.accepted.add(messageId);
  mailbox.push(to);
  return { sent: true, messageId, to, status: 200 };
}

// Inner: receipt verifies outcome
const withReceipt = wrapReceipt(receipt, { send_email: rawSend }, { soft: true });

// Outer: latch checks provenance on plain JSON args
const tools = wrapTools(
  latch,
  {
    send_email: async (args) => withReceipt.send_email!(args),
  },
  {
    onDenied: (err) => ({
      ok: false,
      error_kind: "provenance",
      error: err.message,
      verified: false,
    }),
  },
);

console.log("=== latch + receipt ===\n");

const userMsg = "Please email alice@acme.com about launch";
groundFromUserMessage(latch.store, userMsg, "msg-1");
console.log("User:", userMsg, "\n");

const invented = await tools.send_email!({ to: "board@acme.com", mode: "real" });
console.log("1) Invented board@ →", invented);

const fakeOk = await tools.send_email!({ to: "alice@acme.com", mode: "fake" });
console.log("2) User email but fake SMTP →", fakeOk);

const real = await tools.send_email!({ to: "alice@acme.com", mode: "real" });
console.log("3) User email + real SMTP →", real);

console.log("\n--- latch audit ---\n");
console.log(latch.audit.print());
console.log("\n--- receipt log ---\n");
console.log(receipt.log.print());
console.log("\nMailbox:", mailbox);
console.log("\nOK — invented args blocked; fake success rejected; only real delivery passes.");
