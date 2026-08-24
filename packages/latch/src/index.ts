/**
 * latch — value-level provenance gate for AI agent tool calls.
 *
 * Invariant: a sensitive tool argument may only be used if its value
 * carries an unbroken provenance chain to the user or a verified tool.
 * Model-generated values are tainted and cannot cross the gate.
 *
 * Real tool-calling APIs pass plain JSON. Latch indexes user/tool values so
 * a later plain string that equals a known grounded value still passes.
 */

export type SourceKind = "user" | "tool" | "model" | "derived";

export type Source =
  | { kind: "user"; ref: string }
  | { kind: "tool"; tool: string; callId: string }
  | { kind: "model"; note?: string }
  | { kind: "derived"; parents: string[]; transform: string };

/** Opaque sealed value — only the store can mint these. */
export interface Sealed<T = unknown> {
  readonly __brand: "latch.sealed";
  readonly id: string;
  readonly value: T;
  readonly source: Source;
}

export type AllowRule = SourceKind | SourceKind[];

export interface ArgPolicy {
  /** Dot path into args, e.g. "to" or "destination.path" */
  path: string;
  /** Allowed origin kinds after resolving derived chains */
  allow: AllowRule;
}

export interface ToolPolicy {
  tool: string;
  args: ArgPolicy[];
}

export class ProvenanceError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProvenanceError";
  }
}

export type AuditDecision = "allow" | "deny" | "bypass";

export interface AuditPathDetail {
  path: string;
  value: unknown;
  grounding: SourceKind[];
  allow: SourceKind[];
  matched: "sealed" | "indexed" | "model";
  ok: boolean;
}

export interface AuditEntry {
  id: string;
  ts: number;
  tool: string;
  decision: AuditDecision;
  args: Record<string, unknown>;
  paths: AuditPathDetail[];
  reason?: string;
}

export interface AuditSummary {
  total: number;
  allow: number;
  deny: number;
  bypass: number;
  byTool: Record<string, { allow: number; deny: number; bypass: number }>;
}

/** In-memory decision log for debugging blocked / allowed tool calls. */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private listener?: (entry: AuditEntry) => void;

  on(listener: (entry: AuditEntry) => void): this {
    this.listener = listener;
    return this;
  }

  record(entry: Omit<AuditEntry, "id" | "ts"> & { id?: string; ts?: number }): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      id: entry.id ?? uid(),
      ts: entry.ts ?? Date.now(),
    };
    this.entries.push(full);
    this.listener?.(full);
    return full;
  }

  list(filter?: { tool?: string; decision?: AuditDecision }): AuditEntry[] {
    return this.entries.filter((e) => {
      if (filter?.tool && e.tool !== filter.tool) return false;
      if (filter?.decision && e.decision !== filter.decision) return false;
      return true;
    });
  }

  summary(): AuditSummary {
    const byTool: AuditSummary["byTool"] = {};
    const out: AuditSummary = { total: 0, allow: 0, deny: 0, bypass: 0, byTool };
    for (const e of this.entries) {
      out.total++;
      out[e.decision]++;
      const slot = (byTool[e.tool] ??= { allow: 0, deny: 0, bypass: 0 });
      slot[e.decision]++;
    }
    return out;
  }

  clear(): void {
    this.entries.length = 0;
  }

  /** Human-readable table for terminal debugging. */
  print(filter?: { tool?: string; decision?: AuditDecision }): string {
    const rows = this.list(filter);
    const lines = rows.map((e) => {
      const paths = e.paths
        .map(
          (p) =>
            `${p.path}=${JSON.stringify(p.value)} [${p.matched}/${p.grounding.join("+")}|${p.ok ? "ok" : "NO"}]`,
        )
        .join("; ");
      return `${new Date(e.ts).toISOString()}  ${e.decision.padEnd(6)}  ${e.tool.padEnd(16)}  ${paths || e.reason || ""}`;
    });
    const s = this.summary();
    const header = `latch audit: ${s.allow} allow / ${s.deny} deny / ${s.bypass} bypass (total ${s.total})`;
    return [header, ...lines].join("\n");
  }
}

function uid(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function asAllow(rule: AllowRule): Set<SourceKind> {
  return new Set(Array.isArray(rule) ? rule : [rule]);
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

export function isSealed(v: unknown): v is Sealed {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Sealed).__brand === "latch.sealed" &&
    typeof (v as Sealed).id === "string"
  );
}

/** Canonical key so plain JSON args can match earlier user/tool seals. */
export function valueKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return `${t}:${JSON.stringify(value)}`;
  }
  return null;
}

/**
 * Seals values with origin. Only sealed values can pass tool gates.
 * User/tool (and clean derived) values are indexed for plain-JSON matching.
 */
export class ProvenanceStore {
  private readonly byId = new Map<string, Sealed>();
  /** valueKey → sealed id for grounded (non-model) values */
  private readonly byValue = new Map<string, string>();

  /** Seal a user-provided value (from utterance / form / click). */
  fromUser<T>(value: T, ref: string): Sealed<T> {
    return this.mint(value, { kind: "user", ref }, true);
  }

  /** Seal a verified tool output field. */
  fromTool<T>(value: T, tool: string, callId: string): Sealed<T> {
    return this.mint(value, { kind: "tool", tool, callId }, true);
  }

  /** Explicitly mark model output as tainted. Not indexed as grounded. */
  fromModel<T>(value: T, note?: string): Sealed<T> {
    return this.mint(value, note !== undefined ? { kind: "model", note } : { kind: "model" }, false);
  }

  /**
   * Derive a new value from sealed parents (e.g. normalize email).
   * Indexed only if parents ultimately ground without model.
   */
  derive<T>(value: T, parents: Sealed[], transform: string): Sealed<T> {
    if (!parents.length) {
      throw new ProvenanceError("derive() requires at least one parent", { transform });
    }
    for (const p of parents) this.assertKnown(p);
    const sealed = this.mint(
      value,
      {
        kind: "derived",
        parents: parents.map((p) => p.id),
        transform,
      },
      false,
    );
    const g = this.grounding(sealed);
    if (g.size && !g.has("model")) {
      this.index(sealed);
    }
    return sealed;
  }

  get(id: string): Sealed | undefined {
    return this.byId.get(id);
  }

  /** Look up a previously grounded plain value (user/tool/clean derived). */
  lookupGrounded(value: unknown): Sealed | undefined {
    const key = valueKey(value);
    if (!key) return undefined;
    const id = this.byValue.get(key);
    return id ? this.byId.get(id) : undefined;
  }

  /** Resolve ultimate grounding kinds (user/tool/model) through derived chains. */
  grounding(sealed: Sealed): Set<SourceKind> {
    this.assertKnown(sealed);
    const out = new Set<SourceKind>();
    const walk = (s: Sealed, stack: Set<string>) => {
      if (stack.has(s.id)) return;
      stack.add(s.id);
      if (s.source.kind === "derived") {
        for (const pid of s.source.parents) {
          const parent = this.byId.get(pid);
          if (parent) walk(parent, stack);
        }
      } else {
        out.add(s.source.kind);
      }
    };
    walk(sealed, new Set());
    return out;
  }

  unwrap<T>(sealed: Sealed<T>): T {
    this.assertKnown(sealed);
    return sealed.value;
  }

  private mint<T>(value: T, source: Source, indexable: boolean): Sealed<T> {
    const sealed: Sealed<T> = {
      __brand: "latch.sealed",
      id: uid(),
      value,
      source,
    };
    this.byId.set(sealed.id, sealed as Sealed);
    if (indexable) this.index(sealed as Sealed);
    return sealed;
  }

  private index(sealed: Sealed): void {
    const key = valueKey(sealed.value);
    if (key) this.byValue.set(key, sealed.id);
  }

  private assertKnown(sealed: Sealed): void {
    const known = this.byId.get(sealed.id);
    if (!known || known !== sealed) {
      throw new ProvenanceError("Sealed value is forged or from another store", {
        id: sealed.id,
      });
    }
  }
}

/**
 * Gate: before invoking a tool, check each sensitive arg's provenance.
 * Plain values matching an indexed user/tool seal are treated as grounded.
 * Other plain values are model-tainted.
 */
export class ProvenanceGate {
  private readonly policies = new Map<string, ToolPolicy>();

  constructor(
    private readonly store: ProvenanceStore,
    readonly audit: AuditLog = new AuditLog(),
  ) {}

  policy(toolPolicy: ToolPolicy): this {
    this.policies.set(toolPolicy.tool, toolPolicy);
    return this;
  }

  /** True if this tool has a registered policy (write tools should). */
  hasPolicy(tool: string): boolean {
    return this.policies.has(tool);
  }

  /**
   * Validate args. Returns plain unwrapped args if ok.
   * Throws ProvenanceError if any sensitive path fails.
   */
  check(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    const policy = this.policies.get(tool);
    // No policy → pass-through (only declare policies on mutating / sensitive tools)
    if (!policy) {
      this.audit.record({
        tool,
        decision: "bypass",
        args,
        paths: [],
        reason: "no policy",
      });
      return unwrapDeep(args, this.store) as Record<string, unknown>;
    }

    const pathDetails: AuditPathDetail[] = [];

    for (const rule of policy.args) {
      const raw = getPath(args, rule.path);
      const allowed = asAllow(rule.allow);

      if (raw === undefined || raw === null) {
        const reason = `Missing required arg path: ${rule.path}`;
        this.audit.record({
          tool,
          decision: "deny",
          args,
          paths: pathDetails,
          reason,
        });
        throw new ProvenanceError(reason, {
          tool,
          path: rule.path,
        });
      }

      let sealed: Sealed;
      let matched: AuditPathDetail["matched"];
      if (isSealed(raw)) {
        sealed = raw;
        matched = "sealed";
      } else {
        const hit = this.store.lookupGrounded(raw);
        if (hit) {
          sealed = hit;
          matched = "indexed";
        } else {
          sealed = this.store.fromModel(raw, "unsealed plain value");
          matched = "model";
        }
      }

      const grounding = this.store.grounding(sealed);
      const denied = [...grounding].filter((k) => !allowed.has(k));
      const ok = grounding.size > 0 && denied.length === 0;
      pathDetails.push({
        path: rule.path,
        value: sealed.value,
        grounding: [...grounding],
        allow: [...allowed],
        matched,
        ok,
      });

      if (!ok) {
        const reason = `Provenance denied for ${tool}.${rule.path}: grounding=[${[...grounding].join(",")}] allow=[${[...allowed].join(",")}]`;
        this.audit.record({
          tool,
          decision: "deny",
          args,
          paths: pathDetails,
          reason,
        });
        throw new ProvenanceError(reason, {
          tool,
          path: rule.path,
          grounding: [...grounding],
          allow: [...allowed],
          denied,
          source: sealed.source,
          value: sealed.value,
        });
      }
    }

    this.audit.record({
      tool,
      decision: "allow",
      args,
      paths: pathDetails,
    });
    return unwrapDeep(args, this.store) as Record<string, unknown>;
  }
}

function unwrapDeep(value: unknown, store: ProvenanceStore): unknown {
  if (isSealed(value)) return store.unwrap(value);
  if (Array.isArray(value)) return value.map((v) => unwrapDeep(v, store));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = unwrapDeep(v, store);
    }
    return out;
  }
  return value;
}

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export interface WrapToolsOptions {
  /** Return value (or throw) when provenance denies a call. Default: rethrow. */
  onDenied?: (err: ProvenanceError, tool: string, args: Record<string, unknown>) => unknown;
}

/**
 * Drop-in: wrap a map of tool handlers so every invocation runs gate.check first.
 * Works with OpenAI / Anthropic / AI SDK style plain-JSON tool args.
 */
export function wrapTools(
  latch: { store: ProvenanceStore; gate: ProvenanceGate; audit?: AuditLog },
  tools: Record<string, ToolHandler>,
  opts: WrapToolsOptions = {},
): Record<string, ToolHandler> {
  const out: Record<string, ToolHandler> = {};
  for (const [name, handler] of Object.entries(tools)) {
    out[name] = async (args) => {
      try {
        const plain = latch.gate.check(name, args ?? {});
        return await handler(plain);
      } catch (e) {
        if (e instanceof ProvenanceError && opts.onDenied) {
          return opts.onDenied(e, name, args ?? {});
        }
        throw e;
      }
    };
  }
  return out;
}

/** Wrap one tool — handy for Vercel AI SDK `tool({ execute })`. */
export function latchTool(
  latch: { store: ProvenanceStore; gate: ProvenanceGate; audit?: AuditLog },
  toolName: string,
  execute: ToolHandler,
  opts: WrapToolsOptions = {},
): ToolHandler {
  const wrapped = wrapTools(latch, { [toolName]: execute }, opts);
  const fn = wrapped[toolName];
  if (!fn) throw new Error(`latchTool: failed to wrap ${toolName}`);
  return fn;
}

/**
 * Register policies for several write tools at once.
 */
export function policies(
  gate: ProvenanceGate,
  list: ToolPolicy[],
): ProvenanceGate {
  for (const p of list) gate.policy(p);
  return gate;
}

/**
 * Index obvious literals from a user message (emails, ids). Call once per turn.
 * Extend or replace with your own extractor in production.
 */
export function groundFromUserMessage(
  store: ProvenanceStore,
  message: string,
  messageId: string,
): string[] {
  const grounded: string[] = [];
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const email of message.match(emailRe) ?? []) {
    store.fromUser(email.toLowerCase(), `${messageId}:email`);
    grounded.push(email.toLowerCase());
  }
  return grounded;
}

/**
 * After a lookup tool returns, seal selected fields so later write tools can
 * reuse those plain values as tool-grounded.
 */
export function sealFields(
  store: ProvenanceStore,
  tool: string,
  callId: string,
  result: Record<string, unknown>,
  paths: string[],
): Record<string, unknown> {
  const copy = structuredClone(result);
  for (const path of paths) {
    const v = getPath(copy, path);
    if (v === undefined || v === null) continue;
    const sealed = store.fromTool(v, tool, callId);
    setPath(copy, path, sealed.value); // keep plain for model; indexed in store
    void sealed;
  }
  return copy;
}

export function createProvenance() {
  const store = new ProvenanceStore();
  const audit = new AuditLog();
  const gate = new ProvenanceGate(store, audit);
  return { store, gate, audit };
}

/** Alias — what you tell a colleague: "just latch it". */
export const createLatch = createProvenance;

export type Latch = ReturnType<typeof createLatch>;
