# Release agent-outcome v0.1.0

**Tag:** `agent-outcome-v0.1.0`  
**npm:** [`agent-outcome@0.1.0`](https://www.npmjs.com/package/agent-outcome)

---

## Summary

First public release of **agent-outcome** — verify that agent tool **side effects actually happened**, not just that the handler returned HTTP 200.

> *HTTP 200 is not proof the email sent.*

Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch) (provenance). Install separately; use together when you need both **who/what args are allowed** and **whether the world changed**.

---

## Install

```bash
npm install agent-outcome
# with provenance gate:
npm install agent-latch agent-outcome
```

---

## Quick start

```ts
import { artifacts, createReceipt, wrapReceipt } from "agent-outcome";

const delivered = new Set<string>();

const receipt = createReceipt([
  {
    tool: "send_email",
    artifact: artifacts.field("messageId"),
    verify: ({ artifact }) => !!artifact && delivered.has(artifact),
  },
]);

const tools = wrapReceipt(receipt, {
  send_email: async (args) => {
    const messageId = await smtp.send(args);
    delivered.add(messageId);
    return { messageId, sent: true };
  },
}, { soft: true });
```

Returns an **Envelope**: `{ ok, data | null, artifact, error_kind?, verified }` — `data` is only set when `ok === true`.

---

## With agent-latch

```ts
const withReceipt = wrapReceipt(receipt, { send_email });
const tools = wrapTools(latch, { send_email: withReceipt.send_email });
```

```bash
npm run example:receipt
```

**Three outcomes in the demo:**
1. Invented recipient → blocked by latch (`error_kind: provenance`)
2. User email but fake SMTP success → rejected by outcome (`error_kind: verify_failed`)
3. User email + real delivery → `{ ok: true, data: { ... } }`

---

## What's in this release

### Core
- **`createReceipt()`** — register per-tool artifact + verify policies
- **`wrapReceipt()` / `receiptTool()`** — drop-in after tool execute
- **`settle()`** — post-execute verify with artifact extraction
- **`reconcile()`** — later re-check world state (charges, webhooks)
- **`Envelope`** — machine-readable ok/fail; errors never masquerade as `data`

### Debug
- **`receipt.log.print()`** — terminal table
- **`receipt.log.summary()`** — `{ ok, failed, mismatch, byTool }`

### Demos
| Command | What |
|---|---|
| `npm run demo:receipt` | Fake SMTP 200 rejected |
| `npm run example:receipt` | latch + outcome together |

---

## Honest scope

✅ Rejects tool responses that cannot be verified against your world check  
❌ Does not replace idempotent API design, webhooks, or human approval

---

## Links

- npm: https://www.npmjs.com/package/agent-outcome
- Repo: https://github.com/aarondai23/agent-latch/tree/main/packages/receipt
- Provenance gate: https://www.npmjs.com/package/agent-latch
- Issues: https://github.com/aarondai23/agent-latch/issues

---

## Try it locally

```bash
git clone https://github.com/aarondai23/agent-latch
cd agent-latch && npm install
npm run demo:receipt
npm run example:receipt
```

**31 tests passing** across the monorepo (8 in agent-outcome).

MIT License.
