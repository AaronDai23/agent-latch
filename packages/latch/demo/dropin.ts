/**
 * Realistic drop-in demo: OpenAI-style tool calls are always plain JSON.
 *
 * Without latch: model invents board@acme.com → email sends.
 * With latch: user said alice@… is indexed; invented board@… is blocked.
 */
import { createLatch, sealFields, wrapTools } from "../src/index.js";

type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

const mailbox: { to: string; subject: string }[] = [];
const crm = { Alice: "alice@acme.com" };

function rawTools() {
  return {
    lookup_email: (args: Record<string, unknown>) => {
      const name = String(args.name);
      const email = crm[name as keyof typeof crm];
      if (!email) return { found: false };
      return { found: true, email, name };
    },
    send_email: (args: Record<string, unknown>) => {
      mailbox.push({ to: String(args.to), subject: String(args.subject ?? "") });
      return { sent: true, to: args.to };
    },
  };
}

/** Simulate one agent turn: model emits tool calls as plain JSON. */
async function runAgent(
  tools: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>,
  calls: ToolCall[],
) {
  const results = [];
  for (const call of calls) {
    const fn = tools[call.name];
    if (!fn) throw new Error(`no tool ${call.name}`);
    results.push({ id: call.id, name: call.name, result: await fn(call.arguments) });
  }
  return results;
}

console.log("=== WITHOUT latch ===\n");
mailbox.length = 0;
await runAgent(rawTools(), [
  {
    id: "1",
    name: "send_email",
    arguments: { to: "board@acme.com", subject: "Q4 secrets" }, // model invented
  },
]);
console.log("Mailbox:", mailbox);

console.log("\n=== WITH latch (wrapTools) ===\n");
mailbox.length = 0;

const latch = createLatch();
latch.gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

// User said: "email Alice"
latch.store.fromUser("alice@acme.com", "utterance:email-alice");

const tools = wrapTools(
  latch,
  {
    lookup_email: (args) => {
      const raw = rawTools().lookup_email(args);
      if (raw.found && raw.email) {
        return sealFields(latch.store, "lookup_email", "call_lookup", raw, ["email"]);
      }
      return raw;
    },
    send_email: rawTools().send_email,
  },
  {
    onDenied: (err) => ({
      sent: false,
      blocked: true,
      reason: err.message,
    }),
  },
);

// Model invents board@ — blocked
console.log(
  "Invented board@:",
  await tools.send_email!({ to: "board@acme.com", subject: "Q4 secrets" }),
);

// Model reuses the email the user actually said — allowed
console.log(
  "User-said alice@:",
  await tools.send_email!({ to: "alice@acme.com", subject: "Hello" }),
);

// Model looks up Bob via tool, then sends — allowed via sealFields index
const looked = (await tools.lookup_email!({ name: "Alice" })) as {
  email: string;
};
console.log("CRM lookup:", looked);
console.log(
  "After CRM:",
  await tools.send_email!({ to: looked.email, subject: "From CRM path" }),
);

console.log("\nMailbox after latch:", mailbox);
console.log(
  "\nOK — plain JSON tool-calls work; invented recipients never leave the machine.",
);
