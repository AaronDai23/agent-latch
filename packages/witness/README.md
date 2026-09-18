# agent-latch-witness

**Re-validate high-salience memories before they enter the prompt.**

Stale facts that still look confident (“works at Google”) are more dangerous than forgotten ones. `put()` stores fact + witness recipe; `use()` / `promptBlock()` re-run the witness and never silently inject failed memory as truth.

> Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch).

```bash
npm install agent-latch-witness
```

## Usage

```ts
import { createWitnessStore } from "agent-latch-witness";

const crm = { employer: "Google" };
const store = createWitnessStore();

const job = await store.put(
  "User works at Google",
  { type: "eq", read: () => crm.employer, expect: "Google" },
);

crm.employer = "Anthropic";

const block = await store.promptBlock([job.id]);
// block.facts === []
// block.warnings.includes("[stale] User works at Google …")
```

## Witness recipes

| Type | Behavior |
|---|---|
| `ttl` | Confirmed until `ms` after `put` |
| `eq` | Live `read()` must equal `expect` |
| `version` | Live version must match snapshot at put |
| `check` | Custom predicate; throw → `unverifiable` |

## Honest scope

✅ Stale / unverifiable memories are not prompt-injected as facts  
❌ Does not stop the model from inventing new claims — pair with `agent-latch` on write tools  
❌ In-memory store — persist records if you need cross-process memory

```bash
npm run demo -w agent-latch-witness
```

## License

MIT
