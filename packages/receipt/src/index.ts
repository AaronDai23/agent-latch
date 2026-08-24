/**
 * agent-outcome (Outcome Receipt)
 *
 * Invariant: a mutating tool call is not "done" until an external check
 * confirms the intended outcome. HTTP 200 / tool success text is not enough.
 *
 * Pattern: execute → extract artifact → verify postcondition → envelope.
 * Later: reconcile claimed status against the world.
 */

export type ErrorKind =
  | "timeout"
  | "not_found"
  | "partial"
  | "auth"
  | "verify_failed"
  | "exception"
  | "unknown";

/** Machine-readable status — data is only set when ok === true. */
export interface Envelope<T = unknown> {
  ok: boolean;
  data: T | null;
  artifact?: string | null;
  error_kind?: ErrorKind;
  error?: string;
  tool: string;
  runId?: string;
  verified: boolean;
  ts: number;
}

export type VerifyFn = (ctx: {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  artifact: string | null;
}) => Promise<boolean> | boolean;

export type ArtifactFn = (
  result: unknown,
  args: Record<string, unknown>,
) => string | null | undefined;

export interface ToolReceiptSpec {
  tool: string;
  /** Extract a durable id from the tool result (Message-ID, row id, charge id). */
  artifact?: ArtifactFn;
  /** Confirm the side effect actually landed in the external system. */
  verify: VerifyFn;
  /** If verify fails, treat as this error kind (default: verify_failed). */
  failKind?: ErrorKind;
}

export type ReceiptDecision = "ok" | "failed" | "mismatch";

export interface ReceiptEntry {
  id: string;
  ts: number;
  tool: string;
  runId?: string;
  decision: ReceiptDecision;
  artifact: string | null;
  claimedOk: boolean;
  verified: boolean;
  error_kind?: ErrorKind;
  error?: string;
  args: Record<string, unknown>;
}

export interface ReceiptSummary {
  total: number;
  ok: number;
  failed: number;
  mismatch: number;
  byTool: Record<string, { ok: number; failed: number; mismatch: number }>;
}

export class ReceiptError extends Error {
  constructor(
    message: string,
    readonly envelope: Envelope,
  ) {
    super(message);
    this.name = "ReceiptError";
  }
}

function uid(): string {
  return `rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): number {
  return Date.now();
}

export class ReceiptLog {
  private readonly entries: ReceiptEntry[] = [];
  private listener?: (entry: ReceiptEntry) => void;

  on(listener: (entry: ReceiptEntry) => void): this {
    this.listener = listener;
    return this;
  }

  record(partial: Omit<ReceiptEntry, "id" | "ts"> & { id?: string; ts?: number }): ReceiptEntry {
    const entry: ReceiptEntry = {
      ...partial,
      id: partial.id ?? uid(),
      ts: partial.ts ?? now(),
    };
    this.entries.push(entry);
    this.listener?.(entry);
    return entry;
  }

  list(filter?: { tool?: string; decision?: ReceiptDecision }): ReceiptEntry[] {
    return this.entries.filter((e) => {
      if (filter?.tool && e.tool !== filter.tool) return false;
      if (filter?.decision && e.decision !== filter.decision) return false;
      return true;
    });
  }

  summary(): ReceiptSummary {
    const byTool: ReceiptSummary["byTool"] = {};
    const out: ReceiptSummary = { total: 0, ok: 0, failed: 0, mismatch: 0, byTool };
    for (const e of this.entries) {
      out.total++;
      out[e.decision]++;
      const slot = (byTool[e.tool] ??= { ok: 0, failed: 0, mismatch: 0 });
      slot[e.decision]++;
    }
    return out;
  }

  clear(): void {
    this.entries.length = 0;
  }

  print(filter?: { tool?: string; decision?: ReceiptDecision }): string {
    const rows = this.list(filter);
    const lines = rows.map((e) => {
      const art = e.artifact ? ` artifact=${e.artifact}` : "";
      const err = e.error ? ` — ${e.error}` : "";
      return `${new Date(e.ts).toISOString()}  ${e.decision.padEnd(8)}  ${e.tool.padEnd(16)}${art}${err}`;
    });
    const s = this.summary();
    const header = `receipt: ${s.ok} ok / ${s.failed} failed / ${s.mismatch} mismatch (total ${s.total})`;
    return [header, ...lines].join("\n");
  }
}

export class ReceiptRegistry {
  private readonly specs = new Map<string, ToolReceiptSpec>();

  constructor(readonly log: ReceiptLog = new ReceiptLog()) {}

  register(spec: ToolReceiptSpec): this {
    this.specs.set(spec.tool, spec);
    return this;
  }

  get(tool: string): ToolReceiptSpec | undefined {
    return this.specs.get(tool);
  }

  /**
   * After a tool returns: extract artifact, run verify, return envelope.
   * Throws ReceiptError when verification fails (unless soft).
   */
  async settle<T = unknown>(
    tool: string,
    args: Record<string, unknown>,
    result: T,
    opts: { runId?: string; soft?: boolean; claimedOk?: boolean } = {},
  ): Promise<Envelope<T>> {
    const spec = this.specs.get(tool);
    const claimedOk = opts.claimedOk ?? true;

    if (!spec) {
      // No receipt policy — pass through as unverified success
      const env: Envelope<T> = {
        ok: claimedOk,
        data: claimedOk ? result : null,
        artifact: null,
        tool,
        verified: false,
        ts: now(),
      };
      if (opts.runId !== undefined) env.runId = opts.runId;
      this.log.record({
        tool,
        decision: claimedOk ? "ok" : "failed",
        artifact: null,
        claimedOk,
        verified: false,
        args,
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      });
      return env;
    }

    let artifact: string | null = null;
    try {
      artifact = (spec.artifact?.(result, args) ?? null) as string | null;
    } catch (err) {
      return this.fail<T>(tool, args, {
        error_kind: "exception",
        error: err instanceof Error ? err.message : String(err),
        artifact: null,
        soft: opts.soft === true,
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      });
    }

    let verified = false;
    try {
      verified = await spec.verify({ tool, args, result, artifact });
    } catch (err) {
      return this.fail<T>(tool, args, {
        error_kind: "exception",
        error: err instanceof Error ? err.message : String(err),
        artifact,
        soft: opts.soft === true,
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      });
    }

    if (!verified) {
      return this.fail<T>(tool, args, {
        error_kind: spec.failKind ?? "verify_failed",
        error: `Outcome not confirmed for ${tool}${artifact ? ` (${artifact})` : ""}`,
        artifact,
        soft: opts.soft === true,
        claimedOk,
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      });
    }

    // Claimed failure but verify says world is ok → mismatch (rare but important)
    if (!claimedOk && verified) {
      const env: Envelope<T> = {
        ok: true,
        data: result,
        artifact,
        tool,
        verified: true,
        ts: now(),
        error_kind: "unknown",
        error: "tool claimed failure but outcome verify passed",
      };
      if (opts.runId !== undefined) env.runId = opts.runId;
      const entry: Omit<ReceiptEntry, "id" | "ts"> = {
        tool,
        decision: "mismatch",
        artifact,
        claimedOk: false,
        verified: true,
        args,
        error: "tool claimed failure but outcome verify passed",
        error_kind: "unknown",
      };
      if (opts.runId !== undefined) entry.runId = opts.runId;
      this.log.record(entry);
      return env;
    }

    const env: Envelope<T> = {
      ok: true,
      data: result,
      artifact,
      tool,
      verified: true,
      ts: now(),
    };
    if (opts.runId !== undefined) env.runId = opts.runId;
    const entry: Omit<ReceiptEntry, "id" | "ts"> = {
      tool,
      decision: "ok",
      artifact,
      claimedOk: true,
      verified: true,
      args,
    };
    if (opts.runId !== undefined) entry.runId = opts.runId;
    this.log.record(entry);
    return env;
  }

  /**
   * Reconcile: agent claimed ok, but re-check the world later.
   * Returns mismatch when verify now fails.
   */
  async reconcile(
    tool: string,
    args: Record<string, unknown>,
    result: unknown,
    opts: { runId?: string; artifact?: string | null } = {},
  ): Promise<Envelope> {
    const spec = this.specs.get(tool);
    if (!spec) {
      throw new Error(`No receipt policy for tool: ${tool}`);
    }
    const artifact =
      opts.artifact !== undefined
        ? opts.artifact
        : ((spec.artifact?.(result, args) ?? null) as string | null);

    let verified = false;
    try {
      verified = await spec.verify({ tool, args, result, artifact });
    } catch (err) {
      return this.fail(tool, args, {
        error_kind: "exception",
        error: err instanceof Error ? err.message : String(err),
        artifact,
        soft: true,
        claimedOk: true,
        decision: "mismatch",
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      });
    }

    if (!verified) {
      return this.fail(tool, args, {
        error_kind: "verify_failed",
        error: `Reconcile mismatch: ${tool} claimed ok but world check failed`,
        artifact,
        soft: true,
        claimedOk: true,
        decision: "mismatch",
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      });
    }

    const env: Envelope = {
      ok: true,
      data: result,
      artifact,
      tool,
      verified: true,
      ts: now(),
    };
    if (opts.runId !== undefined) env.runId = opts.runId;
    const entry: Omit<ReceiptEntry, "id" | "ts"> = {
      tool,
      decision: "ok",
      artifact,
      claimedOk: true,
      verified: true,
      args,
    };
    if (opts.runId !== undefined) entry.runId = opts.runId;
    this.log.record(entry);
    return env;
  }

  private fail<T = unknown>(
    tool: string,
    args: Record<string, unknown>,
    opts: {
      error_kind: ErrorKind;
      error: string;
      artifact: string | null;
      runId?: string;
      soft?: boolean;
      claimedOk?: boolean;
      decision?: ReceiptDecision;
    },
  ): Envelope<T> {
    const decision = opts.decision ?? "failed";
    const env: Envelope<T> = {
      ok: false,
      data: null,
      artifact: opts.artifact,
      error_kind: opts.error_kind,
      error: opts.error,
      tool,
      verified: true,
      ts: now(),
    };
    if (opts.runId !== undefined) env.runId = opts.runId;

    const entry: Omit<ReceiptEntry, "id" | "ts"> = {
      tool,
      decision,
      artifact: opts.artifact,
      claimedOk: opts.claimedOk ?? true,
      verified: true,
      args,
      error: opts.error,
      error_kind: opts.error_kind,
    };
    if (opts.runId !== undefined) entry.runId = opts.runId;
    this.log.record(entry);

    if (!opts.soft) {
      throw new ReceiptError(opts.error, env);
    }
    return env;
  }
}

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export interface WrapReceiptOptions {
  runId?: string;
  /** Return envelope instead of throwing on verify failure. Default: throw. */
  soft?: boolean;
  onFailed?: (env: Envelope, tool: string, args: Record<string, unknown>) => unknown;
}

/**
 * Wrap tool handlers: after execute, settle() verifies the outcome.
 * Returns Envelope to the agent (ok + data | error_kind).
 */
export function wrapReceipt(
  registry: ReceiptRegistry,
  tools: Record<string, ToolHandler>,
  opts: WrapReceiptOptions = {},
): Record<string, ToolHandler> {
  const out: Record<string, ToolHandler> = {};
  for (const [name, handler] of Object.entries(tools)) {
    out[name] = async (args) => {
      let result: unknown;
      try {
        result = await handler(args ?? {});
      } catch (err) {
        const env: Envelope = {
          ok: false,
          data: null,
          artifact: null,
          error_kind: "exception",
          error: err instanceof Error ? err.message : String(err),
          tool: name,
          verified: false,
          ts: now(),
        };
        if (opts.runId !== undefined) env.runId = opts.runId;
        const entry: Omit<ReceiptEntry, "id" | "ts"> = {
          tool: name,
          decision: "failed",
          artifact: null,
          claimedOk: false,
          verified: false,
          args: args ?? {},
          error: err instanceof Error ? err.message : String(err),
          error_kind: "exception",
        };
        if (opts.runId !== undefined) entry.runId = opts.runId;
        registry.log.record(entry);
        if (opts.onFailed) return opts.onFailed(env, name, args ?? {});
        if (opts.soft) return env;
        throw err;
      }

      try {
        const settleOpts: { runId?: string; soft?: boolean } = { soft: true };
        if (opts.runId !== undefined) settleOpts.runId = opts.runId;
        const env = await registry.settle(name, args ?? {}, result, settleOpts);
        if (!env.ok) {
          if (opts.onFailed) return opts.onFailed(env, name, args ?? {});
          if (!opts.soft) throw new ReceiptError(env.error ?? "verify failed", env);
        }
        return env;
      } catch (e) {
        if (e instanceof ReceiptError && opts.onFailed) {
          return opts.onFailed(e.envelope, name, args ?? {});
        }
        throw e;
      }
    };
  }
  return out;
}

/** Wrap one tool execute — AI SDK style. */
export function receiptTool(
  registry: ReceiptRegistry,
  toolName: string,
  execute: ToolHandler,
  opts: WrapReceiptOptions = {},
): ToolHandler {
  const wrapped = wrapReceipt(registry, { [toolName]: execute }, opts);
  const fn = wrapped[toolName];
  if (!fn) throw new Error(`receiptTool: failed to wrap ${toolName}`);
  return fn;
}

export function createReceipt(specs: ToolReceiptSpec[] = []): ReceiptRegistry {
  const reg = new ReceiptRegistry();
  for (const s of specs) reg.register(s);
  return reg;
}

/** Helpers for common artifact shapes. */
export const artifacts = {
  field:
    (path: string): ArtifactFn =>
    (result) => {
      if (!result || typeof result !== "object") return null;
      const parts = path.split(".");
      let cur: unknown = result;
      for (const p of parts) {
        if (cur === null || typeof cur !== "object") return null;
        cur = (cur as Record<string, unknown>)[p];
      }
      return cur === undefined || cur === null ? null : String(cur);
    },
};
