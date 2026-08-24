/**
 * latch-witness
 *
 * Invariant: a memory may only be USED after its witness passes.
 * High-salience stale facts are more dangerous than forgotten ones —
 * this package refuses to hand out unverified or failed memories as truth.
 *
 * put() stores fact + witness recipe.
 * use() runs witness; returns Confirmed | Stale | Unverifiable — never silent lie.
 */

export type WitnessRecipe =
  | { type: "ttl"; ms: number }
  | { type: "eq"; read: () => Promise<unknown> | unknown; expect: unknown }
  | { type: "check"; run: (fact: string, meta: Record<string, unknown>) => Promise<boolean> | boolean }
  | { type: "version"; read: () => Promise<string | number> | string | number };

export type MemoryStatus = "confirmed" | "stale" | "unverifiable";

export interface MemoryRecord {
  id: string;
  fact: string;
  meta: Record<string, unknown>;
  witness: WitnessRecipe;
  createdAt: number;
  lastCheckedAt: number | null;
  lastStatus: MemoryStatus | null;
  /** Snapshot taken at put-time for version witnesses */
  versionAtPut?: string | number;
}

export interface UseResult {
  id: string;
  fact: string;
  status: MemoryStatus;
  meta: Record<string, unknown>;
  /** Only safe to inject into prompts when status === "confirmed" */
  usable: boolean;
  detail?: string;
}

export class WitnessError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WitnessError";
  }
}

function uid(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class WitnessStore {
  private readonly items = new Map<string, MemoryRecord>();

  async put(
    fact: string,
    witness: WitnessRecipe,
    meta: Record<string, unknown> = {},
  ): Promise<MemoryRecord> {
    const rec: MemoryRecord = {
      id: uid(),
      fact,
      meta,
      witness,
      createdAt: Date.now(),
      lastCheckedAt: null,
      lastStatus: null,
    };
    if (witness.type === "version") {
      rec.versionAtPut = await witness.read();
    }
    this.items.set(rec.id, rec);
    return rec;
  }

  getRaw(id: string): MemoryRecord | undefined {
    return this.items.get(id);
  }

  list(): MemoryRecord[] {
    return [...this.items.values()];
  }

  /**
   * THE only read path for prompt injection.
   * Always re-runs the witness — no cached "still true" without check.
   */
  async use(id: string): Promise<UseResult> {
    const rec = this.items.get(id);
    if (!rec) {
      throw new WitnessError(`Unknown memory: ${id}`, { id });
    }

    const checked = await this.runWitness(rec);
    rec.lastCheckedAt = Date.now();
    rec.lastStatus = checked.status;

    const result: UseResult = {
      id: rec.id,
      fact: rec.fact,
      status: checked.status,
      meta: rec.meta,
      usable: checked.status === "confirmed",
    };
    if (checked.detail !== undefined) result.detail = checked.detail;
    return result;
  }

  /** Batch: only confirmed facts, in stable order. */
  async useMany(ids: string[]): Promise<UseResult[]> {
    const out: UseResult[] = [];
    for (const id of ids) {
      out.push(await this.use(id));
    }
    return out;
  }

  /** Prompt-safe block: confirmed only; stale listed separately as warnings. */
  async promptBlock(ids: string[]): Promise<{ facts: string[]; warnings: string[] }> {
    const results = await this.useMany(ids);
    const facts: string[] = [];
    const warnings: string[] = [];
    for (const r of results) {
      if (r.usable) facts.push(r.fact);
      else warnings.push(`[${r.status}] ${r.fact}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    return { facts, warnings };
  }

  private async runWitness(
    rec: MemoryRecord,
  ): Promise<{ status: MemoryStatus; detail?: string }> {
    const w = rec.witness;
    try {
      switch (w.type) {
        case "ttl": {
          const age = Date.now() - rec.createdAt;
          if (age > w.ms) {
            return { status: "stale", detail: `ttl exceeded by ${age - w.ms}ms` };
          }
          return { status: "confirmed" };
        }
        case "eq": {
          const live = await w.read();
          if (live === w.expect) return { status: "confirmed" };
          return {
            status: "stale",
            detail: `expected ${JSON.stringify(w.expect)}, live ${JSON.stringify(live)}`,
          };
        }
        case "check": {
          const ok = await w.run(rec.fact, rec.meta);
          return ok
            ? { status: "confirmed" }
            : { status: "stale", detail: "check returned false" };
        }
        case "version": {
          const live = await w.read();
          if (live === rec.versionAtPut) return { status: "confirmed" };
          return {
            status: "stale",
            detail: `version moved ${JSON.stringify(rec.versionAtPut)} → ${JSON.stringify(live)}`,
          };
        }
        default:
          return { status: "unverifiable", detail: "unknown witness type" };
      }
    } catch (err) {
      return {
        status: "unverifiable",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function createWitnessStore(): WitnessStore {
  return new WitnessStore();
}
