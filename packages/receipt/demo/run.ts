/**
 * Demo: tool returns HTTP 200 / sent:true but SMTP never delivered.
 * Without receipt → agent believes success.
 * With receipt → verify fails, envelope ok:false.
 */
import { artifacts, createReceipt, wrapReceipt } from "../src/index.js";

const smtp = {
  // messageId → actually accepted by SMTP
  accepted: new Set<string>(),
};

function fakeSendEmail(to: string) {
  const messageId = `msg_${to.replace(/[^a-z0-9]/gi, "_")}`;
  // Bug: returns success without calling SMTP
  return { status: 200, sent: true, messageId, to };
}

function realSendEmail(to: string) {
  const messageId = `msg_${Date.now()}`;
  smtp.accepted.add(messageId);
  return { status: 200, sent: true, messageId, to };
}

console.log("=== WITHOUT receipt ===\n");
const fake = fakeSendEmail("board@acme.com");
console.log("Tool returned:", fake);
console.log("Agent thinks: email sent ✓");
console.log("SMTP accepted:", [...smtp.accepted]); // empty — silent failure

console.log("\n=== WITH agent-receipt ===\n");

const receipt = createReceipt([
  {
    tool: "send_email",
    artifact: artifacts.field("messageId"),
    verify: ({ artifact }) => !!artifact && smtp.accepted.has(artifact),
  },
]);

receipt.log.on((e) => console.log(`[live] ${e.decision} ${e.tool}`));

const tools = wrapReceipt(
  receipt,
  {
    // Broken path
    send_email_broken: (args) => fakeSendEmail(String(args.to)),
    // Honest path
    send_email: (args) => realSendEmail(String(args.to)),
  },
  { soft: true },
);

// Register verify only for send_email — broken tool uses same check via alias
receipt.register({
  tool: "send_email_broken",
  artifact: artifacts.field("messageId"),
  verify: ({ artifact }) => !!artifact && smtp.accepted.has(artifact),
});

const bad = await tools.send_email_broken!({ to: "board@acme.com" });
console.log("Broken tool settled:", bad);

const good = await tools.send_email!({ to: "alice@acme.com" });
console.log("Real tool settled:", good);

console.log("\n--- receipt.log.print() ---\n");
console.log(receipt.log.print());

console.log("\nSMTP accepted:", [...smtp.accepted]);
console.log("\nOK — HTTP 200 without delivery cannot pass as success.");
