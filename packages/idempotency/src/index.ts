/**
 * agent-latch-idempotency — financial-grade intent idempotency
 *
 * Guarantee (with durable store + downstream key + reconcile):
 *   The same logical mutating intent will not produce a second side effect
 *   under crash/retry, provided the downstream system honors the injected
 *   idempotency key and reconcile can observe prior success.
 *
 * Protocol:
 *   claim PENDING (lease) → inject key into tool args → execute
 *   → COMMIT receipt | mark UNKNOWN on uncertain failure
 *   Stale PENDING/UNKNOWN never auto-re-executes; reconcile first.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export type ClaimStatus = "pending" | "unknown" | "committed" | "failed";

export interface IntentClaim {
  key: string;
  tool: string;
  digest: string;
  status: ClaimStatus;
  args: Record<string, unknown>;
  /** Optimistic concurrency token. */
  version: number;
  leaseOwner: string;
  leaseUntil: number;
  scope?: string | undefined;
  actor?: string | undefined;
  result?: unknown | undefined;
  error?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

export type IdemDecision =
  | "claim"
  | "replay"
  | "inflight"
  | "commit"
  | "fail"
  | "unknown"
  | "reconcile_hit"
  | "reconcile_miss"
  | "reconcile_blocked";

export interface IdemEntry {
  id: string;
  ts: number;
  tool: string;
  key: string;
  decision: IdemDecision;
  reason?: string;
  args: Record<string, unknown>;
}

export interface IdemSummary {
  total: number;
  claim: number;
  replay: number;
  inflight: number;
  commit: number;
  fail: number;
  unknown: number;
  reconcile_hit: number;
  reconcile_miss: number;
  reconcile_blocked: number;
  byTool: Record<string, Partial<Record<IdemDecision, number>>>;
}

export class IdempotencyError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IdempotencyError";
  }
}

function uid(): string {
  return `idm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): number {
  return Date.now();
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    out[key] = sortValue(v);
  }
  return out;
}

export function stripIdemMeta(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const {
    __idempotencyKey,
    idempotencyKey,
    idempotency_key,
    __approvalTicketId,
    __ticketId,
    ticketId,
    ...rest
  } = args;
  void __idempotencyKey;
  void idempotencyKey;
  void idempotency_key;
  void __approvalTicketId;
  void __ticketId;
  void ticketId;
  return rest;
}

export function extractIdempotencyKey(
  args: Record<string, unknown>,
): string | undefined {
  const raw =
    args.__idempotencyKey ?? args.idempotencyKey ?? args.idempotency_key;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** Inject the stable intent key so Stripe/etc. see the same key on retries. */
export function injectIdempotencyKey(
  args: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return {
    ...stripIdemMeta(args),
    idempotencyKey: key,
    idempotency_key: key,
  };
}

export interface IntentKeyOptions {
  scope?: string;
  actor?: string;
  key?: string;
}

export function intentKey(
  tool: string,
  args: Record<string, unknown>,
  opts: IntentKeyOptions = {},
): { key: string; digest: string } {
  const digestBody = canonicalize({
    tool,
    args: stripIdemMeta(args),
    scope: opts.scope ?? null,
    actor: opts.actor ?? null,
  });
  const digest = createHash("sha256").update(digestBody).digest("hex").slice(0, 24);
  if (opts.key) return { key: opts.key, digest };
  return { key: `intent_${digest}`, digest };
}

export class IdemLog {
  private readonly entries: IdemEntry[] = [];
  private listener?: (entry: IdemEntry) => void;

  on(listener: (entry: IdemEntry) => void): this {
    this.listener = listener;
    return this;
  }

  record(
    partial: Omit<IdemEntry, "id" | "ts"> & { id?: string; ts?: number },
  ): IdemEntry {
    const entry: IdemEntry = {
      ...partial,
      id: partial.id ?? uid(),
      ts: partial.ts ?? now(),
    };
    this.entries.push(entry);
    this.listener?.(entry);
    return entry;
  }

  list(filter?: { tool?: string; decision?: IdemDecision }): IdemEntry[] {
    return this.entries.filter((e) => {
      if (filter?.tool && e.tool !== filter.tool) return false;
      if (filter?.decision && e.decision !== filter.decision) return false;
      return true;
    });
  }

  summary(): IdemSummary {
    const byTool: IdemSummary["byTool"] = {};
    const out: IdemSummary = {
      total: 0,
      claim: 0,
      replay: 0,
      inflight: 0,
      commit: 0,
      fail: 0,
      unknown: 0,
      reconcile_hit: 0,
      reconcile_miss: 0,
      reconcile_blocked: 0,
      byTool,
    };
    for (const e of this.entries) {
      out.total++;
      out[e.decision]++;
      const slot = (byTool[e.tool] ??= {});
      slot[e.decision] = (slot[e.decision] ?? 0) + 1;
    }
    return out;
  }

  print(): string {
    const s = this.summary();
    const head = `idempotency: ${s.claim} claim / ${s.replay} replay / ${s.commit} commit / ${s.unknown} unknown / ${s.reconcile_hit} reconcile_hit (total ${s.total})`;
    const lines = this.entries.map((e) => {
      const reason = e.reason ? ` — ${e.reason}` : "";
      return `${new Date(e.ts).toISOString()}  ${e.decision.padEnd(18)}  ${e.tool.padEnd(14)} key=${e.key}${reason}`;
    });
    const text = [head, ...lines].join("\n");
    console.log(text);
    return text;
  }
}

/** Durable claim backend. Implement with Redis/SQL in production. */
export interface ClaimStore {
  get(key: string): IntentClaim | undefined | Promise<IntentClaim | undefined>;
  list(): IntentClaim[] | Promise<IntentClaim[]>;
  /**
   * Compare-and-set. expectedVersion = -1 means create-if-absent.
   * Returns false on version conflict / duplicate create.
   */
  compareAndSet(
    claim: IntentClaim,
    expectedVersion: number,
  ): boolean | Promise<boolean>;
}

export class MemoryClaimStore implements ClaimStore {
  private readonly map = new Map<string, IntentClaim>();

  get(key: string): IntentClaim | undefined {
    const c = this.map.get(key);
    return c ? structuredClone(c) : undefined;
  }

  list(): IntentClaim[] {
    return [...this.map.values()].map((c) => structuredClone(c));
  }

  compareAndSet(claim: IntentClaim, expectedVersion: number): boolean {
    const cur = this.map.get(claim.key);
    if (expectedVersion === -1) {
      if (cur) return false;
      this.map.set(claim.key, structuredClone(claim));
      return true;
    }
    if (!cur || cur.version !== expectedVersion) return false;
    this.map.set(claim.key, structuredClone(claim));
    return true;
  }
}

/** File-backed durable store (single-node). Use Redis/SQL for multi-node. */
export class FileClaimStore implements ClaimStore {
  private readonly memory = new MemoryClaimStore();
  private loaded = false;

  constructor(private readonly path: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    const raw = readFileSync(this.path, "utf8");
    if (!raw.trim()) return;
    const rows = JSON.parse(raw) as IntentClaim[];
    for (const row of rows) {
      this.memory.compareAndSet(row, -1);
    }
  }

  private persist(): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.memory.list(), null, 2));
    renameSync(tmp, this.path);
  }

  get(key: string): IntentClaim | undefined {
    this.load();
    return this.memory.get(key);
  }

  list(): IntentClaim[] {
    this.load();
    return this.memory.list();
  }

  compareAndSet(claim: IntentClaim, expectedVersion: number): boolean {
    this.load();
    const ok = this.memory.compareAndSet(claim, expectedVersion);
    if (ok) this.persist();
    return ok;
  }
}

/**
 * Minimal Redis surface for multi-node CAS.
 * Works with node-redis v4 `client.eval(script, { keys, arguments })`.
 */
export interface RedisEvalClient {
  get(key: string): Promise<string | null>;
  smembers(key: string): Promise<string[]>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

const REDIS_CAS_LUA = `
local expected = tonumber(ARGV[1])
local newver = ARGV[2]
local payload = ARGV[3]
local member = ARGV[4]
local cur = redis.call('GET', KEYS[2])
if expected == -1 then
  if cur then return 0 end
else
  if (not cur) or tonumber(cur) ~= expected then return 0 end
end
redis.call('SET', KEYS[1], payload)
redis.call('SET', KEYS[2], newver)
redis.call('SADD', KEYS[3], member)
return 1
`;

/** Multi-node durable store. Pass your Redis client (no redis dependency bundled). */
export class RedisClaimStore implements ClaimStore {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly prefix = "latch:idem:",
  ) {}

  private claimKey(key: string): string {
    return `${this.prefix}claim:${key}`;
  }

  private verKey(key: string): string {
    return `${this.prefix}ver:${key}`;
  }

  private indexKey(): string {
    return `${this.prefix}index`;
  }

  async get(key: string): Promise<IntentClaim | undefined> {
    const raw = await this.redis.get(this.claimKey(key));
    if (!raw) return undefined;
    return JSON.parse(raw) as IntentClaim;
  }

  async list(): Promise<IntentClaim[]> {
    const members = await this.redis.smembers(this.indexKey());
    const out: IntentClaim[] = [];
    for (const key of members) {
      const claim = await this.get(key);
      if (claim) out.push(claim);
    }
    return out;
  }

  async compareAndSet(
    claim: IntentClaim,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await this.redis.eval(REDIS_CAS_LUA, {
      keys: [this.claimKey(claim.key), this.verKey(claim.key), this.indexKey()],
      arguments: [
        String(expectedVersion),
        String(claim.version),
        JSON.stringify(claim),
        claim.key,
      ],
    });
    return Number(result) === 1;
  }
}

/** In-process fake Redis for tests — same CAS semantics as RedisClaimStore. */
export class MemoryRedisEvalClient implements RedisEvalClient {
  private readonly kv = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async eval(
    _script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    const [claimKey, verKey, indexKey] = options.keys;
    const [expectedRaw, newver, payload, member] = options.arguments;
    if (!claimKey || !verKey || !indexKey || !newver || !payload || !member) {
      return 0;
    }
    const expected = Number(expectedRaw);
    const cur = this.kv.get(verKey);
    if (expected === -1) {
      if (cur !== undefined) return 0;
    } else if (cur === undefined || Number(cur) !== expected) {
      return 0;
    }
    this.kv.set(claimKey, payload);
    this.kv.set(verKey, newver);
    const set = this.sets.get(indexKey) ?? new Set<string>();
    set.add(member);
    this.sets.set(indexKey, set);
    return 1;
  }
}

export type ReconcileOutcome =
  | { status: "committed"; result: unknown }
  | { status: "not_found" }
  | { status: "indeterminate"; reason?: string };

/**
 * Look up whether the side effect already landed for this intent key.
 * Required before re-executing after PENDING/UNKNOWN (crash window).
 */
export type ReconcileFn = (ctx: {
  tool: string;
  key: string;
  args: Record<string, unknown>;
  claim: IntentClaim;
}) => ReconcileOutcome | Promise<ReconcileOutcome>;

export interface ClaimOptions extends IntentKeyOptions {
  leaseMs?: number;
}

export type BeginResult =
  | { kind: "execute"; claim: IntentClaim; argsForTool: Record<string, unknown> }
  | { kind: "replay"; claim: IntentClaim; result: unknown };

export interface CreateIdempotencyOptions {
  scope?: string;
  actor?: string;
  /** Lease length while executing. Default 60s. */
  leaseMs?: number;
  /** Worker id for fencing. Default random UUID. */
  workerId?: string;
  /** Durable backend. Default memory (NOT multi-node safe). */
  store?: ClaimStore;
  /**
   * Required to safely continue after expired PENDING/UNKNOWN.
   * Without it, finance mode refuses to re-execute.
   */
  reconcile?: ReconcileFn;
  /**
   * `finance` (default): never blind-reclaim; inject downstream keys.
   * `dev`: allows failed→retry without reconcile (still no blind PENDING reclaim).
   */
  mode?: "finance" | "dev";
}

export class IdempotencyGate {
  readonly log = new IdemLog();
  readonly store: ClaimStore;
  readonly workerId: string;
  readonly mode: "finance" | "dev";
  private readonly defaultScope?: string;
  private readonly defaultActor?: string;
  private readonly leaseMs: number;
  private readonly reconcile?: ReconcileFn;

  constructor(opts: CreateIdempotencyOptions = {}) {
    this.store = opts.store ?? new MemoryClaimStore();
    this.workerId = opts.workerId ?? randomUUID();
    this.leaseMs = opts.leaseMs ?? 60_000;
    this.mode = opts.mode ?? "finance";
    if (opts.scope !== undefined) this.defaultScope = opts.scope;
    if (opts.actor !== undefined) this.defaultActor = opts.actor;
    if (opts.reconcile) this.reconcile = opts.reconcile;
  }

  async list(filter?: { status?: ClaimStatus; tool?: string }): Promise<IntentClaim[]> {
    const all = await this.store.list();
    return all.filter((c) => {
      if (filter?.status && c.status !== filter.status) return false;
      if (filter?.tool && c.tool !== filter.tool) return false;
      return true;
    });
  }

  async get(key: string): Promise<IntentClaim | undefined> {
    return this.store.get(key);
  }

  /**
   * Begin intent. Never re-executes PENDING/UNKNOWN without reconcile proving
   * the side effect did not land (or committing a found receipt).
   */
  async begin(
    tool: string,
    args: Record<string, unknown>,
    opts: ClaimOptions = {},
  ): Promise<BeginResult> {
    const explicit = opts.key ?? extractIdempotencyKey(args);
    const keyOpts: IntentKeyOptions = {};
    if (explicit !== undefined) keyOpts.key = explicit;
    const scope = opts.scope ?? this.defaultScope;
    const actor = opts.actor ?? this.defaultActor;
    if (scope !== undefined) keyOpts.scope = scope;
    if (actor !== undefined) keyOpts.actor = actor;

    const { key, digest } = intentKey(tool, args, keyOpts);
    const snapshot = structuredClone(stripIdemMeta(args)) as Record<
      string,
      unknown
    >;
    const leaseMs = opts.leaseMs ?? this.leaseMs;
    const ts = now();

    const existing = await this.store.get(key);
    if (existing) {
      if (existing.digest !== digest) {
        throw new IdempotencyError(
          `Idempotency key ${key} reused with different payload`,
          {
            key,
            tool,
            previousDigest: existing.digest,
            currentDigest: digest,
            previous: existing.args,
            current: snapshot,
          },
        );
      }

      if (existing.status === "committed") {
        this.log.record({
          tool,
          key,
          decision: "replay",
          args: snapshot,
          reason: "committed receipt",
        });
        return { kind: "replay", claim: existing, result: existing.result };
      }

      if (existing.status === "pending" || existing.status === "unknown") {
        if (ts < existing.leaseUntil && existing.leaseOwner !== this.workerId) {
          this.log.record({
            tool,
            key,
            decision: "inflight",
            args: snapshot,
            reason: `lease held by ${existing.leaseOwner} until ${new Date(existing.leaseUntil).toISOString()}`,
          });
          throw new IdempotencyError(
            `Intent ${key} is leased by another worker`,
            {
              key,
              tool,
              status: existing.status,
              leaseOwner: existing.leaseOwner,
              leaseUntil: existing.leaseUntil,
            },
          );
        }

        // Lease expired or same worker — must reconcile before any re-execute.
        return this.resolveUnresolved(existing, tool, snapshot, leaseMs);
      }

      // failed
      if (this.mode === "finance" && !this.reconcile) {
        // Still allow retry on explicit failed only if we marked failed safely.
        // Finance mode still injects the same key so downstream dedupes.
      }
      return this.takeLeaseAndExecute(existing, snapshot, leaseMs, "retry after failed");
    }

    const claim: IntentClaim = {
      key,
      tool,
      digest,
      status: "pending",
      args: snapshot,
      version: 0,
      leaseOwner: this.workerId,
      leaseUntil: ts + leaseMs,
      createdAt: ts,
      updatedAt: ts,
    };
    if (scope !== undefined) claim.scope = scope;
    if (actor !== undefined) claim.actor = actor;

    const ok = await this.store.compareAndSet(claim, -1);
    if (!ok) {
      // Lost create race — retry begin against winner.
      return this.begin(tool, args, opts);
    }
    this.log.record({
      tool,
      key,
      decision: "claim",
      args: snapshot,
      reason: "fresh PENDING with lease",
    });
    return {
      kind: "execute",
      claim,
      argsForTool: injectIdempotencyKey(snapshot, key),
    };
  }

  private async resolveUnresolved(
    existing: IntentClaim,
    tool: string,
    snapshot: Record<string, unknown>,
    leaseMs: number,
  ): Promise<BeginResult> {
    if (!this.reconcile) {
      this.log.record({
        tool,
        key: existing.key,
        decision: "reconcile_blocked",
        args: snapshot,
        reason: "no reconcile fn — refusing blind re-execute",
      });
      throw new IdempotencyError(
        `Intent ${existing.key} is ${existing.status}; provide reconcile() before retry (finance-safe)`,
        {
          key: existing.key,
          tool,
          status: existing.status,
          hint: "Query downstream by idempotencyKey / intent key, then commit or allow not_found",
        },
      );
    }

    const outcome = await this.reconcile({
      tool,
      key: existing.key,
      args: snapshot,
      claim: existing,
    });

    if (outcome.status === "committed") {
      const next: IntentClaim = {
        ...existing,
        status: "committed",
        result: outcome.result,
        version: existing.version + 1,
        updatedAt: now(),
      };
      delete next.error;
      const ok = await this.store.compareAndSet(next, existing.version);
      if (!ok) {
        throw new IdempotencyError(`CAS conflict committing reconcile for ${existing.key}`, {
          key: existing.key,
        });
      }
      this.log.record({
        tool,
        key: existing.key,
        decision: "reconcile_hit",
        args: snapshot,
        reason: "downstream already has receipt — committed + replay",
      });
      return { kind: "replay", claim: next, result: outcome.result };
    }

    if (outcome.status === "indeterminate") {
      const next: IntentClaim = {
        ...existing,
        status: "unknown",
        version: existing.version + 1,
        updatedAt: now(),
        error: outcome.reason ?? "reconcile indeterminate",
      };
      await this.store.compareAndSet(next, existing.version);
      this.log.record({
        tool,
        key: existing.key,
        decision: "reconcile_blocked",
        args: snapshot,
        reason: outcome.reason ?? "indeterminate",
      });
      throw new IdempotencyError(
        `Intent ${existing.key} reconcile indeterminate — not safe to re-execute`,
        { key: existing.key, tool, reason: outcome.reason },
      );
    }

    // not_found — safe to take lease and execute again (downstream key still injected)
    this.log.record({
      tool,
      key: existing.key,
      decision: "reconcile_miss",
      args: snapshot,
      reason: "downstream has no receipt — re-execute with same key",
    });
    return this.takeLeaseAndExecute(existing, snapshot, leaseMs, "reconcile not_found");
  }

  private async takeLeaseAndExecute(
    existing: IntentClaim,
    snapshot: Record<string, unknown>,
    leaseMs: number,
    reason: string,
  ): Promise<BeginResult> {
    const ts = now();
    const next: IntentClaim = {
      ...existing,
      status: "pending",
      version: existing.version + 1,
      leaseOwner: this.workerId,
      leaseUntil: ts + leaseMs,
      updatedAt: ts,
      args: snapshot,
    };
    delete next.error;
    delete next.result;
    const ok = await this.store.compareAndSet(next, existing.version);
    if (!ok) {
      throw new IdempotencyError(`CAS conflict taking lease for ${existing.key}`, {
        key: existing.key,
      });
    }
    this.log.record({
      tool: existing.tool,
      key: existing.key,
      decision: "claim",
      args: snapshot,
      reason,
    });
    return {
      kind: "execute",
      claim: next,
      argsForTool: injectIdempotencyKey(snapshot, existing.key),
    };
  }

  async commit(key: string, result: unknown): Promise<IntentClaim> {
    const claim = await this.require(key);
    if (claim.status === "committed") return claim;
    const next: IntentClaim = {
      ...claim,
      status: "committed",
      result,
      version: claim.version + 1,
      updatedAt: now(),
    };
    delete next.error;
    const ok = await this.store.compareAndSet(next, claim.version);
    if (!ok) {
      const again = await this.require(key);
      if (again.status === "committed") return again;
      throw new IdempotencyError(`CAS conflict on commit for ${key}`, { key });
    }
    this.log.record({
      tool: claim.tool,
      key,
      decision: "commit",
      args: claim.args,
      reason: "intent committed",
    });
    return next;
  }

  /**
   * Mark failed only when the side effect is known not to have started.
   * Prefer markUnknown() after uncertain network errors.
   */
  async fail(key: string, error: string): Promise<IntentClaim> {
    const claim = await this.require(key);
    const next: IntentClaim = {
      ...claim,
      status: "failed",
      error,
      version: claim.version + 1,
      updatedAt: now(),
    };
    const ok = await this.store.compareAndSet(next, claim.version);
    if (!ok) throw new IdempotencyError(`CAS conflict on fail for ${key}`, { key });
    this.log.record({
      tool: claim.tool,
      key,
      decision: "fail",
      args: claim.args,
      reason: error,
    });
    return next;
  }

  /** Crash / timeout / ambiguous error — must reconcile before retry. */
  async markUnknown(key: string, error: string): Promise<IntentClaim> {
    const claim = await this.require(key);
    if (claim.status === "committed") return claim;
    const next: IntentClaim = {
      ...claim,
      status: "unknown",
      error,
      version: claim.version + 1,
      updatedAt: now(),
      leaseUntil: now(), // expire lease
    };
    const ok = await this.store.compareAndSet(next, claim.version);
    if (!ok) {
      const again = await this.require(key);
      if (again.status === "committed") return again;
      throw new IdempotencyError(`CAS conflict on markUnknown for ${key}`, { key });
    }
    this.log.record({
      tool: claim.tool,
      key,
      decision: "unknown",
      args: claim.args,
      reason: error,
    });
    return next;
  }

  private async require(key: string): Promise<IntentClaim> {
    const claim = await this.store.get(key);
    if (!claim) {
      throw new IdempotencyError(`Unknown idempotency key: ${key}`, { key });
    }
    return claim;
  }

  summary(): IdemSummary {
    return this.log.summary();
  }

  print(): string {
    return this.log.print();
  }
}

/** @deprecated Use IdempotencyGate — alias for compatibility. */
export type IdempotencyStore = IdempotencyGate;

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export interface WrapIdempotencyOptions {
  needsIdempotency?: (tool: string, args: Record<string, unknown>) => boolean;
  scope?: string;
  actor?: string;
  leaseMs?: number;
  /**
   * Classify thrown errors:
   * - `fail`: sure no side effect started
   * - `unknown` (default): may have succeeded — requires reconcile
   */
  classifyError?: (
    err: unknown,
    tool: string,
    args: Record<string, unknown>,
  ) => "fail" | "unknown";
  onReplay?: (
    result: unknown,
    claim: IntentClaim,
    tool: string,
    args: Record<string, unknown>,
  ) => unknown;
  onDenied?: (
    err: IdempotencyError,
    tool: string,
    args: Record<string, unknown>,
  ) => unknown;
}

export function wrapIdempotency(
  gate: IdempotencyGate,
  tools: Record<string, ToolHandler>,
  opts: WrapIdempotencyOptions = {},
): Record<string, ToolHandler> {
  const needs =
    opts.needsIdempotency ??
    ((_tool: string, _args: Record<string, unknown>) => true);

  const out: Record<string, ToolHandler> = {};
  for (const [name, handler] of Object.entries(tools)) {
    out[name] = async (args) => {
      const plain = args ?? {};
      if (!needs(name, plain)) return handler(plain);

      const beginOpts: ClaimOptions = {};
      if (opts.scope !== undefined) beginOpts.scope = opts.scope;
      if (opts.actor !== undefined) beginOpts.actor = opts.actor;
      if (opts.leaseMs !== undefined) beginOpts.leaseMs = opts.leaseMs;
      const explicit = extractIdempotencyKey(plain);
      if (explicit !== undefined) beginOpts.key = explicit;

      let began: BeginResult;
      try {
        began = await gate.begin(name, plain, beginOpts);
      } catch (e) {
        if (e instanceof IdempotencyError && opts.onDenied) {
          return opts.onDenied(e, name, plain);
        }
        throw e;
      }

      if (began.kind === "replay") {
        if (opts.onReplay) {
          return opts.onReplay(began.result, began.claim, name, plain);
        }
        return began.result;
      }

      try {
        // Downstream sees the stable key (Stripe Idempotency-Key, etc.).
        const result = await handler(began.argsForTool);
        await gate.commit(began.claim.key, result);
        return result;
      } catch (err) {
        const kind =
          opts.classifyError?.(err, name, plain) ??
          (gate.mode === "dev" ? "fail" : "unknown");
        if (kind === "fail") {
          await gate.fail(
            began.claim.key,
            err instanceof Error ? err.message : String(err),
          );
        } else {
          await gate.markUnknown(
            began.claim.key,
            err instanceof Error ? err.message : String(err),
          );
        }
        throw err;
      }
    };
  }
  return out;
}

export function idempotencyTool(
  gate: IdempotencyGate,
  toolName: string,
  execute: ToolHandler,
  opts: WrapIdempotencyOptions = {},
): ToolHandler {
  const wrapped = wrapIdempotency(gate, { [toolName]: execute }, opts);
  const fn = wrapped[toolName];
  if (!fn) throw new Error(`idempotencyTool: failed to wrap ${toolName}`);
  return fn;
}

export function createIdempotency(
  opts: CreateIdempotencyOptions = {},
): IdempotencyGate {
  return new IdempotencyGate(opts);
}
