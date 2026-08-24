# agent-latch-approval

**Human approval must bind to the exact tool payload — deny on drift.**

Companion to [`agent-latch`](https://www.npmjs.com/package/agent-latch). Same monorepo, separate install.

```bash
npm install agent-latch-approval
```

```ts
import { createApproval, wrapApproval } from "agent-latch-approval";

const approval = createApproval();

const tools = wrapApproval(approval, { refund }, {
  onDenied: (err) => ({ error: "approval", message: err.message }),
});

// 1) Agent calls refund → { needs_approval, ticketId, hash, snapshot }
// 2) Human reviews snapshot, then:
approval.approve(ticketId, { by: "ops@acme.com" });
// 3) Agent retries with same args + ticketId → executes
// 4) Agent retries with amount: 999 → ApprovalError (drift)
```

## Invariant

Approval seals a **canonical hash** of the args. Redeem fails if:

- ticket is not `approved`
- tool name mismatches
- ticket expired
- payload hash drifted
- ticket already `used`

## With agent-latch

```ts
const gated = wrapApproval(approval, { refund });
const tools = wrapTools(latch, { refund: gated.refund });
```

```bash
npm run demo:approval
```

## Debug

```ts
approval.listTickets({ status: "pending" });
approval.print();
approval.summary();
```

## License

MIT
