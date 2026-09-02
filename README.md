# Latch

**Stop AI agents from calling dangerous tools with arguments the model invented.**

[![npm: agent-latch](https://img.shields.io/npm/v/agent-latch?label=agent-latch)](https://www.npmjs.com/package/agent-latch)
[![npm: agent-outcome](https://img.shields.io/npm/v/agent-outcome?label=agent-outcome)](https://www.npmjs.com/package/agent-outcome)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![tests](https://img.shields.io/badge/tests-31%20passed-brightgreen)](#try-it)

> *Your agent didn't pick the wrong tool — it invented the email.*

Most guardrails filter **text**. Latch seals **values**. If `to`, `accountId`, or `path` did not come from the user or a verified tool, the call does not run.

```bash
npm install agent-latch
```

![agent-latch demo: invented recipient blocked, user-grounded email allowed](https://raw.githubusercontent.com/AaronDai23/agent-latch/main/docs/demo-screenshot.png)

## See it in 10 seconds

```bash
git clone https://github.com/aarondai23/agent-latch && cd agent-latch
npm install && npm run demo:screenshot
```

**100 invented recipients → 0 escapes** (`npm run bench`)

---

## Vercel AI SDK (copy-paste)

Wrap `tool({ execute })` — the model still sends plain JSON:

```ts
import { createLatch, groundFromUserMessage, latchTool, policies } from "agent-latch";
import { generateText, tool } from "ai";
import { z } from "zod";

const latch = createLatch();
policies(latch.gate, [
  { tool: "send_email", args: [{ path: "to", allow: ["user", "tool"] }] },
]);

await generateText({
  model: yourModel,
  prompt: userMessage,
  tools: {
    send_email: tool({
      parameters: z.object({ to: z.string().email(), subject: z.string() }),
      execute: latchTool(latch, "send_email", sendEmail, {
        onDenied: (err) => ({ error: "blocked", reason: err.message }),
      }),
    }),
  },
});

groundFromUserMessage(latch.store, userMessage, messageId); // call before generateText
console.log(latch.audit.print()); // after
```

Full guide: [`examples/vercel-ai-sdk`](./examples/vercel-ai-sdk) · `npm run example:ai-sdk`

---

## The 5-line drop-in (any tool loop)

```ts
import { createLatch, wrapTools } from "agent-latch";

const latch = createLatch();
latch.gate.policy({ tool: "send_email", args: [{ path: "to", allow: ["user", "tool"] }] });
latch.store.fromUser("alice@acme.com", "msg-1");

const tools = wrapTools(latch, { send_email: sendEmail }, {
  onDenied: (err) => ({ error: "blocked_ungrounded_args", detail: err.detail }),
});

await tools.send_email({ to: "alice@acme.com" }); // ✅
await tools.send_email({ to: "board@acme.com" }); // ❌
```

OpenAI · Anthropic · LangGraph · custom loops — same pattern: **`wrapTools` or `latchTool` before execute**.

---

## Debug & analysis

```ts
latch.audit.print();                  // terminal table
latch.audit.summary();                // { allow, deny, bypass, byTool }
latch.audit.list({ decision: "deny" });
latch.audit.on((e) => console.log(e)); // live
```

```bash
npm run demo:audit
```

---

## Why this pain is real

| Origin | Meaning | Write tools |
|---|---|---|
| `user` | Utterance / form / click | ✅ |
| `tool` | Verified tool result | ✅ |
| `model` | Generated / unknown plain value | ❌ |

**Invariant:** sensitive args must trace to allowed origins. Plain JSON that matches an indexed user/tool value still passes.

## Honest scope

✅ Ungrounded sensitive args cannot execute — **if you wrap the tool path**  
❌ Wrong CRM data, user approving a bad address, bypassing the gate

## Try it

| Command | What |
|---|---|
| `npm run demo` | Sealed-value aha |
| `npm run demo:dropin` | Plain-JSON before/after (verbose) |
| `npm run demo:screenshot` | Clean output for README / GIF |
| `npm run demo:audit` | Why allow/deny |
| `npm run example:ai-sdk` | Vercel AI SDK pattern |
| `npm run bench` | 100 → 0 escapes |

## agent-outcome — verify side effects, not HTTP 200

Tool handlers can return `{ sent: true }` while nothing left SMTP. **agent-outcome** extracts an artifact (message id, charge id, row version) and verifies it against your world.

```bash
npm install agent-outcome
```

```ts
import { artifacts, createReceipt, wrapReceipt } from "agent-outcome";

const receipt = createReceipt([
  {
    tool: "send_email",
    artifact: artifacts.field("messageId"),
    verify: ({ artifact }) => delivered.has(artifact),
  },
]);
```

Full guide: [`packages/receipt`](./packages/receipt) · `npm run demo:receipt` · `npm run example:receipt` (with latch)

---

## More companions (monorepo, not on npm yet)

| Package | When |
|---|---|
| [`agent-latch-budget`](./packages/budget) | Runaway loops burn tokens / money / tool calls |
| [`agent-latch-approval`](./packages/approval) | Human approved one payload; agent executes another |
| [`agent-latch-idempotency`](./packages/idempotency) | Agent retries double-charge or double-send |
| [`agent-latch-saga`](./packages/saga) | Multi-step writes half-break the world |
| [`agent-latch-continuity`](./packages/continuity) | Retries race on agent state |
| [`agent-latch-witness`](./packages/witness) | Stale memory poisons the prompt |

```bash
npm run demo:budget
npm run demo:approval
npm run demo:idempotency
npm run example:gates   # latch + approval + budget stacked
```

## API

```ts
createLatch() → { store, gate, audit }
groundFromUserMessage(store, message, id)  // index emails from user text
policies(gate, ToolPolicy[])
latchTool(latch, name, execute, opts?)     // single tool / AI SDK
wrapTools(latch, tools, opts?)             // tool map
sealFields(store, tool, callId, result, paths)
audit.print() / summary() / list() / on()
```

## Launch / share

- Screenshot: [`docs/demo-screenshot.png`](./docs/demo-screenshot.png)
- Copy-paste posts: [`TWEET.md`](./TWEET.md)
- HN / templates: [`SHARE.md`](./SHARE.md)

## License

MIT
