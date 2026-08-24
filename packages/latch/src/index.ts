/**
 * latch — value-level provenance gate for AI agent tool calls.
 *
 * Invariant: a sensitive tool argument may only be used if its value
 * carries an unbroken provenance chain to the user or a verified tool.
 * Model-generated values are tainted and cannot cross the gate.
 *
 * Untagged plain values are treated as model-tainted by default.
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

function isSealed(v: unknown): v is Sealed {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Sealed).__brand === "latch.sealed" &&
    typeof (v as Sealed).id === "string"
  );
}

/**
 * Seals values with origin. Only sealed values can pass tool gates.
 */
export class ProvenanceStore {
  private readonly byId = new Map<string, Sealed>();

  /** Seal a user-provided value (from utterance / form / click). */
  fromUser<T>(value: T, ref: string): Sealed<T> {
    return this.mint(value, { kind: "user", ref });
  }

  /** Seal a verified tool output field. */
  fromTool<T>(value: T, tool: string, callId: string): Sealed<T> {
    return this.mint(value, { kind: "tool", tool, callId });
  }

  /** Explicitly mark model output as tainted. */
  fromModel<T>(value: T, note?: string): Sealed<T> {
    return this.mint(value, note !== undefined ? { kind: "model", note } : { kind: "model" });
  }

  /**
   * Derive a new value from sealed parents (e.g. normalize email).
   * Kind becomes "derived"; gate resolves through parents.
   */
  derive<T>(value: T, parents: Sealed[], transform: string): Sealed<T> {
    if (!parents.length) {
      throw new ProvenanceError("derive() requires at least one parent", { transform });
    }
    for (const p of parents) this.assertKnown(p);
    return this.mint(value, {
      kind: "derived",
      parents: parents.map((p) => p.id),
      transform,
    });
  }

  get(id: string): Sealed | undefined {
    return this.byId.get(id);
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

  private mint<T>(value: T, source: Source): Sealed<T> {
    const sealed: Sealed<T> = {
      __brand: "latch.sealed",
      id: uid(),
      value,
      source,
    };
    this.byId.set(sealed.id, sealed as Sealed);
    return sealed;
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
 * Plain (unsealed) values are treated as model-tainted.
 */
export class ProvenanceGate {
  private readonly policies = new Map<string, ToolPolicy>();

  constructor(private readonly store: ProvenanceStore) {}

  policy(toolPolicy: ToolPolicy): this {
    this.policies.set(toolPolicy.tool, toolPolicy);
    return this;
  }

  /**
   * Validate args. Returns plain unwrapped args if ok.
   * Throws ProvenanceError if any sensitive path fails.
   */
  check(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    const policy = this.policies.get(tool);
    if (!policy) {
      throw new ProvenanceError(`No provenance policy for tool: ${tool}`, { tool });
    }

    for (const rule of policy.args) {
      const raw = getPath(args, rule.path);
      const allowed = asAllow(rule.allow);

      if (raw === undefined || raw === null) {
        throw new ProvenanceError(`Missing required arg path: ${rule.path}`, {
          tool,
          path: rule.path,
        });
      }

      let sealed: Sealed;
      if (isSealed(raw)) {
        sealed = raw;
      } else {
        // Untagged = model-tainted. Seal temporarily for uniform error reporting.
        sealed = this.store.fromModel(raw, "unsealed plain value");
      }

      const grounding = this.store.grounding(sealed);
      // Invariant: every ultimate origin must be explicitly allowed.
      const denied = [...grounding].filter((k) => !allowed.has(k));
      if (!grounding.size || denied.length) {
        throw new ProvenanceError(
          `Provenance denied for ${tool}.${rule.path}: grounding=[${[...grounding].join(",")}] allow=[${[...allowed].join(",")}]`,
          {
            tool,
            path: rule.path,
            grounding: [...grounding],
            allow: [...allowed],
            denied,
            source: sealed.source,
            value: sealed.value,
          },
        );
      }
    }

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

export function createProvenance() {
  const store = new ProvenanceStore();
  const gate = new ProvenanceGate(store);
  return { store, gate };
}

/** Alias — what you tell a colleague: "just latch it". */
export const createLatch = createProvenance;
