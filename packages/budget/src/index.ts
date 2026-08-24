/**
 * agent-latch-budget — Budget Enforcer
 *
 * Invariant: a mutating / expensive tool call may not run once a budget
 * (calls, tokens, or money) would be exceeded. Runaway loops die at the gate.
 */

export type MeterKind = "calls" | "tokens" | "usd_cents";

export type BreachAction = "deny" | "warn";

export interface BudgetLimit {
  /** Stable id for this meter, e.g. "tenant:acme:calls". */
  id: string;
  kind: MeterKind;
  /** Hard ceiling (inclusive: usage must stay <= max). */
  max: number;
  /** Optional: only apply when this tool is invoked. */
  tool?: string;
  /** Optional tenant / agent scope tag for filtering. */
  scope?: string;
  /** What to do on breach. Default: deny. */
  onBreach?: BreachAction;
}

export interface UsageDelta {
  calls?: number;
  tokens?: number;
  usdCents?: number;
}

export interface BudgetSnapshot {
  id: string;
  kind: MeterKind;
  max: number;
  used: number;
  remaining: number;
  tool?: string;
  scope?: string;
}

export type BudgetDecision = "allow" | "deny" | "warn";

export interface BudgetEntry {
  id: string;
  ts: number;
  tool: string;
  decision: BudgetDecision;
  limitId?: string;
  kind?: MeterKind;
  used?: number;
  max?: number;
  delta: UsageDelta;
  reason?: string;
  args: Record<string, unknown>;
}

export interface BudgetSummary {
  total: number;
  allow: number;
  deny: number;
  warn: number;
  byTool: Record<string, { allow: number; deny: number; warn: number }>;
  meters: BudgetSnapshot[];
}

export class BudgetError extends Error {
  constructor(
    message: string,
    readonly detail: {
      limitId: string;
      kind: MeterKind;
      used: number;
      max: number;
      tool: string;
      delta: UsageDelta;
    },
  ) {
    super(message);
    this.name = "BudgetError";
  }
}

function uid(): string {
  return `bdg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): number {
  return Date.now();
}

function deltaForKind(kind: MeterKind, delta: UsageDelta): number {
  if (kind === "calls") return delta.calls ?? 0;
  if (kind === "tokens") return delta.tokens ?? 0;
  return delta.usdCents ?? 0;
}

export class BudgetLog {
  private readonly entries: BudgetEntry[] = [];
  private listener?: (entry: BudgetEntry) => void;

  on(listener: (entry: BudgetEntry) => void): this {
    this.listener = listener;
    return this;
  }

  record(partial: Omit<BudgetEntry, "id" | "ts"> & { id?: string; ts?: number }): BudgetEntry {
    const entry: BudgetEntry = {
      ...partial,
      id: partial.id ?? uid(),
      ts: partial.ts ?? now(),
    };
    this.entries.push(entry);
    this.listener?.(entry);
    return entry;
  }

  list(filter?: { tool?: string; decision?: BudgetDecision }): BudgetEntry[] {
    return this.entries.filter((e) => {
      if (filter?.tool && e.tool !== filter.tool) return false;
      if (filter?.decision && e.decision !== filter.decision) return false;
      return true;
    });
  }

  summary(meters: BudgetSnapshot[]): BudgetSummary {
    const byTool: BudgetSummary["byTool"] = {};
    const out: BudgetSummary = { total: 0, allow: 0, deny: 0, warn: 0, byTool, meters };
    for (const e of this.entries) {
      out.total++;
      out[e.decision]++;
      const slot = (byTool[e.tool] ??= { allow: 0, deny: 0, warn: 0 });
      slot[e.decision]++;
    }
    return out;
  }

  print(): string {
    const lines = this.entries.map((e) => {
      const meter =
        e.limitId !== undefined
          ? ` ${e.limitId} ${e.used}/${e.max}`
          : "";
      const reason = e.reason ? ` — ${e.reason}` : "";
      return `${new Date(e.ts).toISOString()}  ${e.decision.padEnd(5)}  ${e.tool.padEnd(16)}${meter}${reason}`;
    });
    const head = `budget: ${this.entries.filter((e) => e.decision === "allow").length} allow / ${this.entries.filter((e) => e.decision === "deny").length} deny / ${this.entries.filter((e) => e.decision === "warn").length} warn (total ${this.entries.length})`;
    const text = [head, ...lines].join("\n");
    console.log(text);
    return text;
  }
}

export type CostEstimator = (
  tool: string,
  args: Record<string, unknown>,
) => UsageDelta | Promise<UsageDelta>;

export interface CreateBudgetOptions {
  limits?: BudgetLimit[];
  /** Default cost when no estimator is provided. */
  defaultDelta?: UsageDelta;
  /** Scope tag applied when matching scoped limits. */
  scope?: string;
}

export class BudgetEnforcer {
  readonly log = new BudgetLog();
  /** Default usage charged per call when no estimator is set. */
  readonly defaultDelta: UsageDelta;
  private readonly limits: BudgetLimit[] = [];
  private readonly used = new Map<string, number>();
  private readonly scope?: string;

  constructor(opts: CreateBudgetOptions = {}) {
    this.defaultDelta = opts.defaultDelta ?? { calls: 1 };
    if (opts.scope !== undefined) this.scope = opts.scope;
    for (const lim of opts.limits ?? []) this.addLimit(lim);
  }

  addLimit(limit: BudgetLimit): this {
    if (limit.max < 0) throw new BudgetError(`Invalid max for ${limit.id}`, {
      limitId: limit.id,
      kind: limit.kind,
      used: 0,
      max: limit.max,
      tool: "*",
      delta: {},
    });
    this.limits.push(limit);
    if (!this.used.has(limit.id)) this.used.set(limit.id, 0);
    return this;
  }

  /** Current usage snapshot for all meters. */
  meters(): BudgetSnapshot[] {
    return this.limits.map((lim) => {
      const used = this.used.get(lim.id) ?? 0;
      const snap: BudgetSnapshot = {
        id: lim.id,
        kind: lim.kind,
        max: lim.max,
        used,
        remaining: Math.max(0, lim.max - used),
      };
      if (lim.tool !== undefined) snap.tool = lim.tool;
      if (lim.scope !== undefined) snap.scope = lim.scope;
      return snap;
    });
  }

  usage(limitId: string): number {
    return this.used.get(limitId) ?? 0;
  }

  /** Reset one meter or all meters. */
  reset(limitId?: string): void {
    if (limitId) {
      this.used.set(limitId, 0);
      return;
    }
    for (const id of this.used.keys()) this.used.set(id, 0);
  }

  private applicable(tool: string): BudgetLimit[] {
    return this.limits.filter((lim) => {
      if (lim.tool !== undefined && lim.tool !== tool) return false;
      if (lim.scope !== undefined && lim.scope !== this.scope) return false;
      return true;
    });
  }

  /**
   * Check whether `delta` would breach any applicable limit.
   * Does not mutate usage. Throws BudgetError when a deny-limit would breach.
   * Returns warn entries for warn-limits that would breach.
   */
  check(
    tool: string,
    args: Record<string, unknown>,
    delta: UsageDelta = this.defaultDelta,
  ): { ok: true; warnings: BudgetEntry[] } {
    const warnings: BudgetEntry[] = [];
    for (const lim of this.applicable(tool)) {
      const add = deltaForKind(lim.kind, delta);
      if (add <= 0) continue;
      const used = this.used.get(lim.id) ?? 0;
      const next = used + add;
      if (next <= lim.max) continue;

      const action = lim.onBreach ?? "deny";
      const reason = `Budget ${lim.id} would exceed: ${used}+${add} > ${lim.max} (${lim.kind})`;
      const entry = this.log.record({
        tool,
        decision: action,
        limitId: lim.id,
        kind: lim.kind,
        used,
        max: lim.max,
        delta,
        reason,
        args,
      });
      if (action === "deny") {
        throw new BudgetError(reason, {
          limitId: lim.id,
          kind: lim.kind,
          used,
          max: lim.max,
          tool,
          delta,
        });
      }
      warnings.push(entry);
    }
    return { ok: true, warnings };
  }

  /** Apply usage after a successful (or attempted) call. */
  consume(delta: UsageDelta, tool = "*"): void {
    for (const lim of this.applicable(tool)) {
      const add = deltaForKind(lim.kind, delta);
      if (add <= 0) continue;
      this.used.set(lim.id, (this.used.get(lim.id) ?? 0) + add);
    }
    // Also bump global (no tool filter) meters even when tool-scoped ones exist —
    // applicable() already includes unscoped limits for this tool.
  }

  /**
   * check → consume on allow. Records an allow entry.
   * Throws BudgetError on deny breach.
   */
  authorize(
    tool: string,
    args: Record<string, unknown>,
    delta: UsageDelta = this.defaultDelta,
  ): { warnings: BudgetEntry[] } {
    const { warnings } = this.check(tool, args, delta);
    this.consume(delta, tool);
    this.log.record({
      tool,
      decision: "allow",
      delta,
      args,
    });
    return { warnings };
  }

  summary(): BudgetSummary {
    return this.log.summary(this.meters());
  }

  print(): string {
    return this.log.print();
  }
}

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export interface WrapBudgetOptions {
  /** Estimate cost before the call. Default: { calls: 1 }. */
  estimate?: CostEstimator;
  /** Return value instead of throwing on BudgetError. */
  onDenied?: (err: BudgetError, tool: string, args: Record<string, unknown>) => unknown;
  /**
   * When true, still consume on successful execute even if estimate was used
   * for the pre-check. Default true.
   */
  consumeOnSuccess?: boolean;
}

/**
 * Wrap tool handlers: authorize budget before execute.
 */
export function wrapBudget(
  budget: BudgetEnforcer,
  tools: Record<string, ToolHandler>,
  opts: WrapBudgetOptions = {},
): Record<string, ToolHandler> {
  const consumeOnSuccess = opts.consumeOnSuccess !== false;
  const out: Record<string, ToolHandler> = {};
  for (const [name, handler] of Object.entries(tools)) {
    out[name] = async (args) => {
      const plain = args ?? {};
      let delta: UsageDelta = { ...budget.defaultDelta };
      try {
        delta = opts.estimate
          ? await opts.estimate(name, plain)
          : { ...budget.defaultDelta };
        // Pre-check only; consume after successful execute.
        budget.check(name, plain, delta);
      } catch (e) {
        if (e instanceof BudgetError && opts.onDenied) {
          return opts.onDenied(e, name, plain);
        }
        throw e;
      }

      const result = await handler(plain);

      if (consumeOnSuccess) {
        budget.consume(delta, name);
        budget.log.record({
          tool: name,
          decision: "allow",
          delta,
          args: plain,
        });
      }
      return result;
    };
  }
  return out;
}

/** Wrap one tool — AI SDK `tool({ execute })` style. */
export function budgetTool(
  budget: BudgetEnforcer,
  toolName: string,
  execute: ToolHandler,
  opts: WrapBudgetOptions = {},
): ToolHandler {
  const wrapped = wrapBudget(budget, { [toolName]: execute }, opts);
  const fn = wrapped[toolName];
  if (!fn) throw new Error(`budgetTool: failed to wrap ${toolName}`);
  return fn;
}

export function createBudget(opts: CreateBudgetOptions = {}): BudgetEnforcer {
  return new BudgetEnforcer(opts);
}
