# agent-outcome

**HTTP 200 is not proof the email sent.**

Agents often treat a successful tool response as a completed side effect. In production the response can be 200 while the email never left SMTP, the DB row never committed, or the charge never landed.

`agent-outcome` forces an **outcome check** after mutating tools: extract an artifact → verify against the world → return a machine-readable envelope.

> Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch) (provenance). Same monorepo, separate install.

```bash
npm install agent-outcome
```

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

// Returns Envelope: { ok, data | null, artifact, error_kind?, verified }
```

## Envelope (invariant)

| Field | Rule |
|---|---|
| `ok` | true only if verify passed |
| `data` | **only** set when `ok === true` (model cannot read errors as answers) |
| `artifact` | durable id (Message-ID, charge id, row version) |
| `error_kind` | `timeout` \| `not_found` \| `partial` \| `verify_failed` \| … |
| `verified` | whether a receipt policy ran |

## With agent-latch

```ts
// 1) latch — block invented args
// 2) outcome — confirm side effect landed
const withReceipt = wrapReceipt(receipt, { send_email });
const tools = wrapTools(latch, { send_email: withReceipt.send_email });
```

```bash
npm run example:receipt
```

## Reconcile later

```ts
await receipt.reconcile("charge", args, result, { artifact: "ch_1" });
```

## Debug

```ts
receipt.log.print();
receipt.log.summary(); // { ok, failed, mismatch, byTool }
```

## License

MIT
