/**
 * Screenshot-friendly demo — clean terminal output, no npm noise.
 * Run: npm run demo:screenshot
 */
import { createLatch, sealFields, wrapTools } from "../src/index.js";

const W = 58;
const line = (c = "─") => c.repeat(W);
const box = (title: string, body: string[]) => {
  console.log(`┌${line()}┐`);
  console.log(`│ ${title.padEnd(W - 2)} │`);
  console.log(`├${line()}┤`);
  for (const row of body) console.log(`│ ${row.padEnd(W - 2)} │`);
  console.log(`└${line()}┘`);
};

const mailbox: { to: string; subject: string }[] = [];

// ── WITHOUT latch ──
mailbox.length = 0;
mailbox.push({ to: "board@acme.com", subject: "Q4 secrets" });

box("WITHOUT latch", [
  "Model tool call:",
  '  send_email({ to: "board@acme.com" })',
  "",
  "Result:  ✗ SENT (invented recipient)",
  "",
  "Mailbox: board@acme.com  ← leaked",
]);

console.log("");

// ── WITH latch ──
mailbox.length = 0;
const latch = createLatch();
latch.gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});
latch.store.fromUser("alice@acme.com", "utterance:1");

const tools = wrapTools(
  latch,
  {
    send_email: (args) => {
      mailbox.push({ to: String(args.to), subject: String(args.subject ?? "") });
      return { sent: true, to: args.to };
    },
  },
  {
    onDenied: () => ({ sent: false, blocked: true }),
  },
);

const invented = await tools.send_email!({ to: "board@acme.com", subject: "Q4 secrets" });
const allowed = await tools.send_email!({ to: "alice@acme.com", subject: "Hello" });

box("WITH agent-latch", [
  'User said: "email alice@acme.com"',
  "",
  "Model tool call #1:",
  '  send_email({ to: "board@acme.com" })',
  `  → ${invented.blocked ? "BLOCKED ✓" : "SENT ✗"}`,
  "",
  "Model tool call #2:",
  '  send_email({ to: "alice@acme.com" })',
  `  → ${allowed.sent ? "ALLOWED ✓ (user-grounded)" : "BLOCKED"}`,
  "",
  `Mailbox: ${mailbox.map((m) => m.to).join(", ") || "(empty)"}`,
]);

console.log("");
box("bench", [
  "100 invented recipients without latch → 100 sends",
  "100 invented recipients with latch    →   0 sends",
  "",
  "npm install agent-latch",
]);

console.log("");
