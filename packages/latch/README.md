# agent-latch

**Stop AI agents from calling dangerous tools with arguments the model invented.**

> *Your agent didn't pick the wrong tool — it invented the email.*

```bash
npm install agent-latch
```

![agent-latch demo: invented recipient blocked, user-grounded email allowed](https://raw.githubusercontent.com/AaronDai23/agent-latch/main/docs/demo-screenshot.png)

Most guardrails filter **text**. Latch seals **values**. If `to`, `accountId`, or `path` did not come from the user or a verified tool, the call does not run.

## Quick start

```ts
import { createLatch, wrapTools } from "agent-latch";

const latch = createLatch();
latch.gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

latch.store.fromUser("alice@acme.com", "msg-1");

const tools = wrapTools(latch, { send_email: sendEmail }, {
  onDenied: (err) => ({ error: "blocked", reason: err.message }),
});
```

**Vercel AI SDK:** use `latchTool(latch, "send_email", execute)` — see [full docs](https://github.com/AaronDai23/agent-latch#vercel-ai-sdk-copy-paste).

**100 invented recipients → 0 escapes**

Full README: [github.com/AaronDai23/agent-latch](https://github.com/AaronDai23/agent-latch)
