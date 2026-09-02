# agent-latch-idempotency

**Financial-grade intent idempotency for agent write tools.**

Agent frameworks retry tools as *new* calls after timeouts/crashes. SDK-level idempotency keys do not help if each retry generates a new key. This package sits **above** the tool and enforces:

1. **Durable claim** (memory or file; plug in Redis/SQL)
2. **Same key injected into downstream args** (`idempotencyKey`)
3. **No blind reclaim** after crash — **reconcile** against the world first

> Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch).

```bash
npm install agent-latch-idempotency
```

## Finance-safe usage

```ts
import {
  createIdempotency,
  FileClaimStore,
  RedisClaimStore,
  wrapIdempotency,
} from "agent-latch-idempotency";
import { createClient } from "redis"; // your dependency

const redis = createClient();
await redis.connect();

const idem = createIdempotency({
  mode: "finance",
  // Single-node: new FileClaimStore("./data/idem-claims.json")
  // Multi-node:
  store: new RedisClaimStore(redis),
  reconcile: async ({ key }) => {
    const hit = await stripe.charges.retrieveByIdempotencyKey(key);
    if (hit) return { status: "committed", result: hit };
    return { status: "not_found" };
  },
});
```

`RedisClaimStore` takes any client that implements `get` / `smembers` / `eval` (node-redis v4 shape). No `redis` package is bundled — you wire your own.

## Protocol

| State | Meaning | Retry behavior |
|---|---|---|
| `pending` + valid lease | Another worker executing | **Deny** (inflight) |
| `committed` | Receipt known | **Replay** |
| `failed` | Side effect known not started | Retry with **same key** |
| `unknown` / expired `pending` | Crash window | **Reconcile only** — never blind re-exec |

Reconcile outcomes:
- `committed` → local commit + replay
- `not_found` → re-execute with **same** downstream key
- `indeterminate` → stay blocked (human/ops)

## Guarantees (honest)

**Provided when all three are true:**
1. Claim store is **durable and shared** across workers
2. Downstream **honors** the injected idempotency key
3. `reconcile()` can observe prior success after crashes

**Not claimed:** magical exactly-once without downstream support, or safety if you use memory store across multiple nodes.

## Dev mode

```ts
createIdempotency({ mode: "dev" }) // uncertain errors → fail (easier demos)
```

Default `finance` marks uncertain errors as `unknown` and requires reconcile.

```bash
npm run demo:idempotency
```

## License

MIT
