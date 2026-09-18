/**
 * LangGraph-shaped failure (issue #7417):
 * A long tool is still running when the runtime re-dispatches the same node
 * from the last checkpoint. Without claim-before-tool → double side effect.
 * With agent-latch-idempotency → concurrent re-dispatch is denied (inflight);
 * after commit, a later dispatch replays the receipt.
 *
 * No LangGraph dependency — drop this wrap into a real tool node.
 *
 *   npm run example:langgraph
 */
import {
  createIdempotency,
  wrapIdempotency,
} from "../../packages/idempotency/src/index.js";

type ChargeResult = { chargeId: string; amount: number; attempt: number };

const stripe = new Map<string, ChargeResult>();
let executeCount = 0;

const idem = createIdempotency({
  mode: "finance",
  scope: "langgraph-demo",
  leaseMs: 120_000,
  reconcile: ({ key }) => {
    const hit = stripe.get(key);
    if (hit) return { status: "committed", result: hit };
    return { status: "not_found" };
  },
});

const chargeTool = wrapIdempotency(
  idem,
  {
    charge: async (args: Record<string, unknown>): Promise<ChargeResult> => {
      const key = String(args.idempotencyKey);
      const existing = stripe.get(key);
      if (existing) return existing;

      executeCount += 1;
      // Simulate a long tool call that outlives BG_JOB_HEARTBEAT (~180s).
      await new Promise((r) => setTimeout(r, 40));

      const receipt: ChargeResult = {
        chargeId: `ch_${executeCount}`,
        amount: Number(args.amount),
        attempt: executeCount,
      };
      stripe.set(key, receipt);
      return receipt;
    },
  },
  {
    onReplay: (result, claim) => ({
      ok: true,
      replayed: true,
      key: claim.key,
      data: result,
    }),
    onDenied: (err) => ({
      ok: false,
      error_kind: "idempotency",
      error: err.message,
      detail: err.detail,
    }),
  },
);

async function langGraphToolNode(
  args: { customer: string; amount: number },
  label: string,
) {
  console.log(`\n[${label}] tool node invoke`, args);
  const out = await chargeTool.charge!(args);
  console.log(`[${label}] result`, out);
  return out;
}

console.log("=== LangGraph claim-before-tool (idempotency) ===");
console.log(
  "Scenario: checkpoint re-dispatch while first tool node still running\n",
);

const args = { customer: "alice", amount: 42 };

const firstPromise = langGraphToolNode(args, "dispatch-1");
await new Promise((r) => setTimeout(r, 5));
const concurrent = await langGraphToolNode(args, "dispatch-2-concurrent");
const firstResult = await firstPromise;
const afterCommit = await langGraphToolNode(args, "dispatch-3-after-commit");

console.log("\n--- world ---");
console.log("stripe rows:", [...stripe.values()]);
console.log("executeCount (real side effects):", executeCount);
console.log("dispatch-1:", firstResult);
console.log("dispatch-2 (concurrent):", concurrent);
console.log("dispatch-3 (after commit):", afterCommit);

const concurrentDenied =
  concurrent &&
  typeof concurrent === "object" &&
  (concurrent as { error_kind?: string }).error_kind === "idempotency";
const replayed =
  afterCommit &&
  typeof afterCommit === "object" &&
  (afterCommit as { replayed?: boolean }).replayed === true;

const ok = executeCount === 1 && stripe.size === 1 && concurrentDenied && replayed;

if (!ok) {
  console.error(
    "\nFAIL — expected one Stripe charge, concurrent deny, then replay.",
  );
  process.exit(1);
}

console.log(
  "\nOK — checkpoint re-dispatch did not double-charge. Wrap LangGraph tool nodes with wrapIdempotency the same way.",
);
