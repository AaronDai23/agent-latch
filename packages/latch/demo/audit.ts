/**
 * Debug / analysis demo — every gate decision is inspectable.
 */
import { createLatch, wrapTools } from "../src/index.js";

const latch = createLatch();
latch.gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

// Live stream each decision (optional)
latch.audit.on((e) => {
  console.log(`[live] ${e.decision} ${e.tool}`);
});

latch.store.fromUser("alice@acme.com", "msg-1");

const tools = wrapTools(
  latch,
  {
    send_email: (args) => ({ sent: true, to: args.to }),
    ping: () => ({ ok: true }), // no policy → bypass
  },
  {
    onDenied: (err) => ({ sent: false, blocked: true, reason: err.message }),
  },
);

console.log("=== latch audit demo ===\n");

await tools.send_email!({ to: "alice@acme.com", subject: "hi" });
await tools.send_email!({ to: "board@acme.com", subject: "nope" });
await tools.ping!({});

console.log("\n--- audit.print() ---\n");
console.log(latch.audit.print());

console.log("\n--- summary() ---\n");
console.log(latch.audit.summary());

console.log("\n--- denied only ---\n");
console.log(
  latch.audit.list({ decision: "deny" }).map((e) => ({
    tool: e.tool,
    reason: e.reason,
    path: e.paths[0],
  })),
);
