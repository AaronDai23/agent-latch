# Release v0.1.3 — agent-latch

**Tag:** `v0.1.3`  
**npm:** `agent-latch@0.1.3`

---

## Summary

First public release of **Latch** — a provenance gate that stops AI agents from calling dangerous tools with **model-invented arguments** (emails, IDs, paths).

> *Your agent didn't pick the wrong tool — it invented the email.*

Most guardrails filter text. Latch seals **values**. If a sensitive argument did not come from the user or a verified tool, the call does not run.

---

## Install

```bash
npm install agent-latch
```

---

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

**Vercel AI SDK:** wrap `tool({ execute })` with `latchTool` — see [`examples/vercel-ai-sdk`](./examples/vercel-ai-sdk).

---

## What's in this release

### Core
- **Provenance gate** — sensitive tool args must trace to `user` or `tool`
- **Plain JSON support** — indexes grounded values; model tool calls stay plain strings
- **`wrapTools` / `latchTool`** — drop-in before any tool execute
- **`sealFields`** — CRM lookup → later send_email works
- **`groundFromUserMessage`** — auto-index emails from user text

### Debug
- **`audit` log** — `print()`, `summary()`, `list({ decision: "deny" })`, live `on()` listener
- Every allow/deny shows path, value, match type (`indexed` / `model`), grounding

### Demos & evidence
| Command | What |
|---|---|
| `npm run demo:dropin` | Before/after plain JSON tool calls |
| `npm run demo:screenshot` | Clean terminal output for README/GIF |
| `npm run demo:audit` | Inspect blocked calls |
| `npm run example:ai-sdk` | Vercel AI SDK pattern (no API key) |
| `npm run bench` | 100 invented emails → **0 escapes** |

### Docs
- [`SHARE.md`](./SHARE.md) — tweet / HN launch copy
- [`examples/vercel-ai-sdk/README.md`](./examples/vercel-ai-sdk/README.md) — copy-paste integration

---

## Benchmark

```
Invented recipients:     100
Sends without latch:     100
Sends with latch:        0
Escape rate:             0.0%
```

---

## Honest scope

✅ Blocks ungrounded sensitive args **when you wrap the tool path**  
❌ Does not fix wrong CRM data, user-approved bad addresses, or bypassed gates

---

## Companion packages (monorepo, not on npm yet)

| Package | Purpose |
|---|---|
| `agent-latch-saga` | LIFO compensation for multi-step writes |
| `agent-latch-continuity` | Propose/commit kernel for agent state |
| `agent-latch-witness` | Re-validate stale memories before prompt use |

Install when you hit the matching failure — start with `agent-latch` only.

---

## Breaking changes

None — first release.

---

## Links

- npm: https://www.npmjs.com/package/agent-latch
- Repo: https://github.com/aarondai23/agent-latch
- Issues: https://github.com/aarondai23/agent-latch/issues

---

## Try it locally

```bash
git clone https://github.com/aarondai23/agent-latch
cd agent-latch && npm install
npm run demo:screenshot
npm test
```

**23 tests passing.**

---

## Feedback wanted

- Which sensitive fields would you gate first (`to`, `accountId`, `path`, …)?
- Framework adapters you'd like next (LangGraph, Mastra, …)?
- Real incident stories where invented args caused damage?

MIT License.
