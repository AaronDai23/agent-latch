# LangGraph: claim before tool

Addresses the failure class in [langchain-ai/langgraph#7417](https://github.com/langchain-ai/langgraph/issues/7417): long tool calls re-dispatched from checkpoint while the original is still running → duplicate side effects.

## Pattern

```ts
import { createIdempotency, wrapIdempotency } from "agent-latch-idempotency";

const idem = createIdempotency({
  mode: "finance",
  store: yourDurableClaimStore, // FileClaimStore / RedisClaimStore
  reconcile: async ({ key }) => {
    const hit = await provider.lookupByIdempotencyKey(key);
    return hit
      ? { status: "committed", result: hit }
      : { status: "not_found" };
  },
});

// Inside the tool node — wrap BEFORE side effects
const tools = wrapIdempotency(idem, { charge: chargeFn });
```

Stable intent comes from **tool args** (customer + amount + scope), not from LangGraph attempt / run ids. Downstream must honor the injected `idempotencyKey`.

## Run (no LangGraph install required)

```bash
npm run example:langgraph
```

This repo demo simulates dual dispatch. Drop the same wrap into a real `@langchain/langgraph` tool node.
