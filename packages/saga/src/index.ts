/**
 * latch-saga
 *
 * Invariant: every mutating effect is logged BEFORE execution with a
 * compensation. On failure, compensations run LIFO and are idempotent.
 * Irreversible effects require an explicit acknowledge; they never pretend
 * to undo — they only record mitigation.
 */

export type Reversibility = "compensatable" | "irreversible";

export type EffectStatus =
  | "intent" // logged, not yet executed
  | "done"
  | "failed"
  | "compensating"
  | "compensated"
  | "mitigated"; // irreversible: cannot undo, mitigation noted

export interface EffectRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  reversibility: Reversibility;
  status: EffectStatus;
  result?: unknown;
  error?: string;
  compensationError?: string;
  mitigation?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ToolDef<A extends Record<string, unknown> = Record<string, unknown>, R = unknown> {
  name: string;
  reversibility: Reversibility;
  execute: (args: A) => Promise<R> | R;
  /** Required when compensatable. Must be idempotent. */
  compensate?: (args: A, result: R | undefined) => Promise<void> | void;
  /** Required when irreversible — called on saga failure after this step. */
  mitigate?: (args: A, result: R | undefined, reason: string) => Promise<string> | string;
}

export class SagaError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SagaError";
  }
}

function uid(): string {
  return `fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function now(): number {
  return Date.now();
}

/** Append-only effect log. Durable enough for crash recovery if you persist it. */
export class EffectLog {
  readonly records: EffectRecord[] = [];

  append(partial: Omit<EffectRecord, "createdAt" | "updatedAt">): EffectRecord {
    const ts = now();
    const rec: EffectRecord = { ...partial, createdAt: ts, updatedAt: ts };
    this.records.push(rec);
    return rec;
  }

  update(id: string, patch: Partial<EffectRecord>): EffectRecord {
    const rec = this.records.find((r) => r.id === id);
    if (!rec) throw new SagaError(`Unknown effect: ${id}`, { id });
    Object.assign(rec, patch, { updatedAt: now() });
    return rec;
  }

  /** Effects that need reconcile after crash (intent without done). */
  inFlight(): EffectRecord[] {
    return this.records.filter((r) => r.status === "intent");
  }

  stack(): EffectRecord[] {
    return this.records.filter((r) => r.status === "done");
  }
}

export class SagaRuntime {
  private readonly tools = new Map<string, ToolDef>();

  constructor(readonly log: EffectLog = new EffectLog()) {}

  register<A extends Record<string, unknown>, R>(def: ToolDef<A, R>): this {
    if (def.reversibility === "compensatable" && !def.compensate) {
      throw new SagaError(`Tool ${def.name} is compensatable but has no compensate()`, {
        tool: def.name,
      });
    }
    if (def.reversibility === "irreversible" && !def.mitigate) {
      throw new SagaError(`Tool ${def.name} is irreversible but has no mitigate()`, {
        tool: def.name,
      });
    }
    this.tools.set(def.name, def as ToolDef);
    return this;
  }

  /**
   * Run a saga body. On any throw: compensate/mitigate in reverse order.
   */
  async run<T>(body: (tx: SagaTx) => Promise<T>): Promise<T> {
    const tx = new SagaTx(this);
    try {
      return await body(tx);
    } catch (err) {
      await this.rollback(tx.effectIds, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** Recover after crash: compensate anything left in intent or done for a run. */
  async recover(reason = "crash recovery"): Promise<void> {
    const ids = [...this.log.inFlight(), ...this.log.stack()].map((r) => r.id).reverse();
    // For in-flight: we don't know if execute completed — compensate if possible.
    await this.rollback(ids, reason);
  }

  async call<A extends Record<string, unknown>, R = unknown>(
    tool: string,
    args: A,
  ): Promise<{ effectId: string; result: R }> {
    const def = this.tools.get(tool);
    if (!def) throw new SagaError(`Unknown tool: ${tool}`, { tool });

    const id = uid();
    // Ahead-of-log: durable intent BEFORE side effect
    this.log.append({
      id,
      tool,
      args,
      reversibility: def.reversibility,
      status: "intent",
    });

    try {
      const result = (await def.execute(args)) as R;
      this.log.update(id, { status: "done", result });
      return { effectId: id, result };
    } catch (err) {
      this.log.update(id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async rollback(effectIds: string[], reason: string): Promise<void> {
    // LIFO
    for (const id of [...effectIds].reverse()) {
      const rec = this.log.records.find((r) => r.id === id);
      if (!rec) continue;
      if (rec.status === "compensated" || rec.status === "mitigated") continue;
      if (rec.status === "failed") continue;

      const def = this.tools.get(rec.tool);
      if (!def) continue;

      if (rec.reversibility === "compensatable" && def.compensate) {
        this.log.update(id, { status: "compensating" });
        try {
          await def.compensate(rec.args, rec.result);
          this.log.update(id, { status: "compensated" });
        } catch (err) {
          this.log.update(id, {
            status: "failed",
            compensationError: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (rec.reversibility === "irreversible" && def.mitigate) {
        const mitigation = await def.mitigate(rec.args, rec.result, reason);
        this.log.update(id, { status: "mitigated", mitigation });
      }
    }
  }
}

export class SagaTx {
  readonly effectIds: string[] = [];

  constructor(private readonly runtime: SagaRuntime) {}

  async call<A extends Record<string, unknown>, R = unknown>(
    tool: string,
    args: A,
  ): Promise<R> {
    const { effectId, result } = await this.runtime.call<A, R>(tool, args);
    this.effectIds.push(effectId);
    return result;
  }
}

export function createSaga(log?: EffectLog) {
  return new SagaRuntime(log);
}
