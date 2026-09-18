# agent-latch-saga

**Ahead-of-log side effects with LIFO compensation.**

Multi-step agent writes often leave the world half-broken: charge succeeded, ship failed, email already went out. This package logs every mutating effect **before** execute, then on failure runs compensations in reverse (or honest mitigation for irreversible steps).

> Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch).

```bash
npm install agent-latch-saga
```

## Usage

```ts
import { createSaga, FileEffectLog } from "agent-latch-saga";

const saga = createSaga(new FileEffectLog("./data/saga-effects.json"));

saga
  .register({
    name: "charge",
    reversibility: "compensatable",
    execute: async (args) => stripe.charges.create(args),
    compensate: async (args, result) => {
      if (result?.id) await stripe.refunds.create({ charge: result.id });
    },
  })
  .register({
    name: "notify",
    reversibility: "irreversible",
    execute: async (args) => mail.send(args),
    mitigate: async (args, _r, reason) => {
      await mail.send({ to: args.to, subject: `Follow-up (${reason})` });
      return "apology queued";
    },
  });

await saga.run(async (tx) => {
  await tx.call("charge", { amount: 99, customer: "cus_1" });
  await tx.call("notify", { to: "buyer@acme.com" });
});
```

## Protocol

| Status | Meaning |
|---|---|
| `intent` | Logged, execute not finished |
| `done` | Side effect completed |
| `failed` | Execute threw |
| `compensated` | Undo ran |
| `mitigated` | Irreversible — mitigation recorded, not fake undo |

On body throw: **LIFO** compensate/mitigate for effects already `done` (and best-effort for `intent`).

## Honest scope

✅ Partial multi-step writes leave a coherent compensation trail  
✅ Irreversible steps cannot pretend to unsend mail  

❌ Default `EffectLog` is in-memory — use `FileEffectLog` for single-node persistence  
❌ Not multi-worker exactly-once — pair write tools with [`agent-latch-idempotency`](https://www.npmjs.com/package/agent-latch-idempotency)

```bash
npm run demo -w agent-latch-saga
```

## License

MIT
