# Composing Latch gates

Recommended order for **mutating** tools (call path, outer → inner):

```text
latch (provenance)
  → approval (exact payload hash)
    → budget (calls / tokens / money)
      → idempotency (durable claim + downstream key)
        → receipt / outcome (verify world)
          → raw tool execute
```

## Why this order

1. **Provenance first** — never spend budget or open a claim on invented args.
2. **Approval next** — bind the human to the exact payload before money moves.
3. **Budget** — meter intended spend after policy allows the shape.
4. **Idempotency** — claim immediately before the side effect (LangGraph re-dispatch safe).
5. **Receipt last before/around execute** — HTTP 200 is not proof; verify artifact in the world.

## Wrap code (innermost first)

```ts
const withReceipt = wrapReceipt(receipt, raw);
const withIdem = wrapIdempotency(idem, withReceipt);
const withBudget = wrapBudget(budget, withIdem);
const withApproval = wrapApproval(approval, withBudget);
const tools = wrapTools(latch, withApproval);
```

## What each gate does *not* do

| Gate | Does not replace |
|---|---|
| latch | Correct CRM / user intent |
| approval | Your HITL UX product |
| budget | Provider hard billing limits |
| idempotency | Downstream that ignores keys |
| receipt | Monitoring / traces alone |
| saga | Tool-level exactly-once |
| continuity | Tool side-effect ledger |

## Examples

| Command | Stack |
|---|---|
| `npm run example:gates` | latch + approval + budget |
| `npm run example:compose` | full write path (5 gates) |
| `npm run example:langgraph` | idempotency vs checkpoint re-dispatch |
| `npm run example:receipt` | latch + outcome |

## Optional companions

- **saga** — multi-step compensate/mitigate after a chain fails
- **continuity** — agent state propose/commit (not tool effects)
- **witness** — re-check memories before prompt injection
