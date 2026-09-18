# agent-latch-continuity

**Only the control plane advances agent state.**

Models, tools, and workers may **propose**. The kernel alone **commits**. Every commit cites an exact predecessor head — stale retries and concurrent workers cannot silently overwrite the branch. Proposers cannot self-grant authority via the patch.

> Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch).

```bash
npm install agent-latch-continuity
```

## Usage

```ts
import { createKernel } from "agent-latch-continuity";

const k = createKernel().grant("operator");
const head = k.openBranch("run-1", { plan: "idle" });

const a = k.propose({
  branch: "run-1",
  predecessor: head.id,
  patch: { plan: "email Alice" },
  requires: ["operator"],
});

const b = k.propose({
  branch: "run-1",
  predecessor: head.id, // same head — second commit will be stale
  patch: { plan: "email Board" },
  requires: ["operator"],
});

k.commit(a); // accept
k.commit(b); // reject: stale predecessor
```

## Why checkpoint resume is not enough

LangGraph / durable runners restore **graph state**. They do not stop two workers from applying two different patches after a crash. Continuity makes activation explicit: no head advance without `commit()`.

Pair with [`agent-latch-idempotency`](https://www.npmjs.com/package/agent-latch-idempotency) for **tool side effects**; use this package for **agent control-plane state**.

## Honest scope

✅ Stale / concurrent proposals cannot advance the head  
✅ Missing authority rejects; patch cannot smuggle `__authorities`  

❌ In-process kernel today — persist heads yourself for multi-node  
❌ Does not replace tool-level idempotency or saga compensation

```bash
npm run demo -w agent-latch-continuity
```

## License

MIT
