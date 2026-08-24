/**
 * Simulates Vercel AI SDK generateText + tool({ execute }) without an API key.
 * Same integration points as the real SDK — see README.md for copy-paste.
 */
import {
  createLatch,
  groundFromUserMessage,
  latchTool,
  policies,
} from "../../packages/latch/src/index.js";

type ToolCall = { name: string; args: Record<string, unknown> };

/** Minimal stand-in for AI SDK tool registry. */
function tool<T extends Record<string, unknown>>(
  def: { execute: (args: T) => Promise<unknown> | unknown },
) {
  return def;
}

const mailbox: { to: string; subject: string }[] = [];

async function sendEmail(args: { to: string; subject: string }) {
  mailbox.push(args);
  return { sent: true, ...args };
}

const latch = createLatch();
policies(latch.gate, [
  {
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  },
]);

const tools = {
  send_email: tool({
    execute: latchTool(
      latch,
      "send_email",
      async (args) => sendEmail({ to: String(args.to), subject: String(args.subject) }),
      {
        onDenied: (err) => ({
          error: "blocked_ungrounded_args",
          reason: err.message,
        }),
      },
    ),
  }),
};

/** Fake model: picks tool calls from user message + one invented recipient. */
function fakeModel(userMessage: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const m = userMessage.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (m) {
    calls.push({
      name: "send_email",
      args: { to: m[0]!.toLowerCase(), subject: "As requested" },
    });
  }
  calls.push({
    name: "send_email",
    args: { to: "board@acme.com", subject: "Invented by model" },
  });
  return calls;
}

async function runAgent(userMessage: string, messageId: string) {
  groundFromUserMessage(latch.store, userMessage, messageId);
  const calls = fakeModel(userMessage);
  const results = [];
  for (const call of calls) {
    const t = tools[call.name as keyof typeof tools];
    results.push({
      tool: call.name,
      args: call.args,
      result: await t.execute(call.args),
    });
  }
  return results;
}

console.log("=== Vercel AI SDK pattern (simulated) ===\n");

const userMsg = "Please email alice@acme.com about the launch";
console.log("User:", userMsg, "\n");

const results = await runAgent(userMsg, "msg-42");
for (const r of results) {
  console.log(`${r.tool}(${JSON.stringify(r.args)}) →`, r.result);
}

console.log("\n--- audit ---\n");
console.log(latch.audit.print());
console.log("\nMailbox:", mailbox);
console.log(
  "\nOK — same hooks as AI SDK tool({ execute: latchTool(...) }). No API key needed.",
);
