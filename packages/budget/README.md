# agent-latch-budget

**Stop runaway agents from burning calls, tokens, or money.**

Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch). Same monorepo, separate install.

```bash
npm install agent-latch-budget
```

```ts
import { createBudget, wrapBudget } from "agent-latch-budget";

const budget = createBudget({
  limits: [
    { id: "calls", kind: "calls", max: 100 },
    { id: "spend", kind: "usd_cents", max: 5000, tool: "charge" },
  ],
});

const tools = wrapBudget(budget, { charge, lookup }, {
  estimate: (tool, args) =>
    tool === "charge"
      ? { calls: 1, usdCents: Number(args.amount ?? 0) }
      : { calls: 1 },
  onDenied: (err) => ({ error: "budget_exceeded", limit: err.detail.limitId }),
});
```

## Meters

| kind | Meaning |
|---|---|
| `calls` | Tool invocations |
| `tokens` | Estimated / billed tokens |
| `usd_cents` | Money in cents |

Limits can be global or scoped to a `tool` / `scope` (tenant).

## With agent-latch

```ts
const gated = wrapBudget(budget, { send_email });
const tools = wrapTools(latch, { send_email: gated.send_email });
```

```bash
npm run demo:budget
```

## Debug

```ts
budget.meters();   // [{ id, used, max, remaining, kind }]
budget.print();
budget.summary();
```

## License

MIT
