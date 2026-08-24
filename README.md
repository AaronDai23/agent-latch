# Latch

**Stop AI agents from calling dangerous tools with arguments the model invented.**

Most guardrails filter text. Latch seals **values**. If `to`, `accountId`, or `path` did not come from the user or a verified tool, the call does not run.

```bash
npm install agent-latch
```

```ts
import { createProvenance } from "agent-latch";

const { store, gate } = createProvenance();

gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

// ✅ user typed it
gate.check("send_email", {
  to: store.fromUser("alice@acme.com", "msg-1"),
});

// ❌ model guessed it — throws ProvenanceError
gate.check("send_email", {
  to: store.fromModel("board@acme.com"),
});
```

## Why people forward this

Agents do not usually fail by picking the wrong tool. They fail by **filling the right tool with a hallucinated ID, email, or path**. That bug is silent, confident, and expensive.

Latch makes origin a hard gate:

| Origin | Meaning | Typical allow on write tools |
|---|---|---|
| `user` | From an utterance, form, or click | ✅ |
| `tool` | From a verified tool result | ✅ |
| `model` | Generated / unsealed plain value | ❌ |
| `derived` | Transform of sealed parents | inherits parents |

**Invariant:** every sensitive argument’s ultimate grounding must be explicitly allowed. Untagged values are treated as `model`.

## 30-second aha

```bash
git clone <this-repo> && cd latch
npm install
npm run demo      # invents a recipient → DENIED
npm run bench     # 100 invented emails → 0 escapes
```

## Drop into a tool loop

```ts
import { createProvenance, ProvenanceError } from "agent-latch";

const { store, gate } = createProvenance();
gate.policy({
  tool: "send_email",
  args: [{ path: "to", allow: ["user", "tool"] }],
});

async function callTool(name: string, args: Record<string, unknown>) {
  try {
    const plain = gate.check(name, args); // unwraps sealed values
    return await realSendEmail(plain);
  } catch (e) {
    if (e instanceof ProvenanceError) {
      return { error: "blocked_ungrounded_args", detail: e.detail };
    }
    throw e;
  }
}

// When the user speaks:
const to = store.fromUser(extractedEmail, utteranceId);
// When CRM returns:
const to = store.fromTool(row.email, "crm.lookup", callId);
// When the model proposes a string with no seal — gate.check rejects it.
```

No framework lock-in. One `gate.check` before every mutating tool.

## Evidence, not vibes

`npm run bench` simulates 100 model-invented recipients against a `send_email` policy:

- **with Latch:** 0 sends
- **without:** 100 sends to fiction

That is the recommendable sentence: *“It blocked every invented recipient in the suite.”*

## Companions (install when the next pain shows up)

Start with `latch`. Add these only when you hit the matching failure:

| Package | When you need it |
|---|---|
| [`agent-latch-saga`](./packages/saga) | Multi-step writes leave the world half-broken — need LIFO compensate |
| [`agent-latch-continuity`](./packages/continuity) | Retries / workers race on authoritative agent state |
| [`agent-latch-witness`](./packages/witness) | High-salience memories go stale but still enter the prompt |

Same brand, same “hard invariant” style — but **one wedge first**.

## API surface (intentionally tiny)

```ts
store.fromUser(value, ref)
store.fromTool(value, tool, callId)
store.fromModel(value, note?)
store.derive(value, parents, transform)

gate.policy({ tool, args: [{ path, allow }] })
gate.check(tool, args) // → plain args or throws ProvenanceError
```

## Status

v0.1 — correct core, MIT, tested. Not a full AgentOps platform on purpose.

```bash
npm test
npm run build
```

## License

MIT
