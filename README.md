# Latch

**Stop AI agents from calling dangerous tools with arguments the model invented.**

Most guardrails filter text. Latch seals **values**. If `to`, `accountId`, or `path` did not come from the user or a verified tool, the call does not run.

```bash
npm install agent-latch
```

## The 5-line drop-in

Tool-calling APIs always pass **plain JSON**. Latch indexes what the user (or a tool) already grounded, then wraps your handlers:

```ts
import { createLatch, wrapTools } from "agent-latch";

const latch = createLatch();
latch.gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

// User said “email alice@acme.com”
latch.store.fromUser("alice@acme.com", "msg-1");

const tools = wrapTools(latch, {
  send_email: async (args) => sendEmail(args),
}, {
  onDenied: (err) => ({ error: "blocked_ungrounded_args", detail: err.detail }),
});

await tools.send_email({ to: "alice@acme.com" }); // ✅ same value user said
await tools.send_email({ to: "board@acme.com" }); // ❌ model invented → blocked
```

Works with OpenAI / Anthropic / Vercel AI SDK style tool maps — no framework lock-in.

## Why this pain is real

Agents rarely fail by picking the wrong tool. They fail by **filling the right tool with a hallucinated ID, email, or path**. Text filters do not see that. Latch does.

| Origin | Meaning | Typical allow on write tools |
|---|---|---|
| `user` | From an utterance, form, or click | ✅ |
| `tool` | From a verified tool result | ✅ |
| `model` | Generated / unknown plain value | ❌ |
| `derived` | Transform of sealed parents | inherits parents |

**Invariant:** every sensitive argument’s ultimate grounding must be explicitly allowed.

## Honest scope

Latch guarantees: *ungrounded sensitive args cannot execute — if you wrap the tool path.*

It does **not** guarantee: correct CRM data, users approving bad addresses, or safety if you bypass `wrapTools` / `gate.check`.

## Try it

```bash
npm install
npm run demo          # sealed-value aha
npm run demo:dropin   # plain-JSON tool-call before/after
npm run bench         # 100 invented emails → 0 escapes
```

## CRM → send pattern

```ts
import { createLatch, sealFields, wrapTools } from "agent-latch";

const latch = createLatch();
latch.gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

const tools = wrapTools(latch, {
  lookup_email: async (args) => {
    const row = await crm.find(args.name);
    // indexes row.email as tool-grounded for later plain JSON reuse
    return sealFields(latch.store, "lookup_email", "c1", row, ["email"]);
  },
  send_email: async (args) => sendEmail(args),
});
```

## Evidence

`npm run bench`:

- **without Latch:** 100/100 invented recipients would send  
- **with Latch:** 0 escapes  

## Companions (later)

| Package | When you need it |
|---|---|
| [`agent-latch-saga`](./packages/saga) | Multi-step writes leave the world half-broken |
| [`agent-latch-continuity`](./packages/continuity) | Retries / workers race on agent state |
| [`agent-latch-witness`](./packages/witness) | Stale high-salience memory poisons the prompt |

## API

```ts
createLatch() / createProvenance()
store.fromUser / fromTool / fromModel / derive
store.lookupGrounded(value)
gate.policy({ tool, args })
gate.check(tool, args)
wrapTools(latch, tools, { onDenied? })
sealFields(store, tool, callId, result, paths)
```

## Status

v0.1.x — MIT, tested. A hard gate, not an AgentOps platform.

## License

MIT
