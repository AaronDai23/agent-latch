/**
 * latch-continuity
 *
 * Invariant: models/tools/workers may only PROPOSE. The kernel alone COMMITS.
 * Every commit cites an exact predecessor head. Stale retries and self-authorized
 * privilege escalation cannot advance the branch.
 *
 * Simplified Continuity Kernel — enough to make the activation boundary real.
 */

import { createHash } from "node:crypto";

export type Disposition = "accept" | "reject" | "defer";

export interface BranchHead {
  id: string;
  branch: string;
  seq: number;
  state: Record<string, unknown>;
  /** Hash chain over prior head + this state */
  receipt: string;
  predecessor: string | null;
  committedAt: number;
}

export interface Proposal {
  id: string;
  branch: string;
  /** Must equal current head id (or null for first commit) */
  predecessor: string | null;
  /** Shallow merge patch applied on accept */
  patch: Record<string, unknown>;
  /** Evidence the kernel can verify before activate */
  evidence?: Evidence[];
  /** Claimed authority — kernel checks, proposer cannot grant itself */
  requires?: string[];
  note?: string;
}

export type Evidence =
  | { type: "always" }
  | { type: "predicate"; name: string }
  | { type: "absent_key"; key: string };

export interface CommitResult {
  disposition: Disposition;
  reason: string;
  head?: BranchHead;
  proposalId: string;
}

export class ContinuityError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContinuityError";
  }
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function receiptOf(predecessor: string | null, state: Record<string, unknown>, seq: number): string {
  const body = JSON.stringify({ predecessor, state, seq });
  return createHash("sha256").update(body).digest("hex").slice(0, 24);
}

type Predicate = (state: Record<string, unknown>, patch: Record<string, unknown>) => boolean;

/**
 * Deterministic control plane. Proposers are untrusted.
 */
export class ContinuityKernel {
  private readonly heads = new Map<string, BranchHead>();
  private readonly history = new Map<string, BranchHead[]>();
  private readonly predicates = new Map<string, Predicate>();
  private authorities = new Set<string>(["system"]);

  /** Grant authority tokens the kernel will honor on requires[]. */
  grant(...tokens: string[]): this {
    for (const t of tokens) this.authorities.add(t);
    return this;
  }

  revoke(...tokens: string[]): this {
    for (const t of tokens) this.authorities.delete(t);
    return this;
  }

  /** Register a named predicate used by evidence type "predicate". */
  predicate(name: string, fn: Predicate): this {
    this.predicates.set(name, fn);
    return this;
  }

  openBranch(branch: string, initial: Record<string, unknown> = {}): BranchHead {
    if (this.heads.has(branch)) {
      throw new ContinuityError(`Branch already open: ${branch}`, { branch });
    }
    const head: BranchHead = {
      id: uid("head"),
      branch,
      seq: 0,
      state: { ...initial },
      receipt: receiptOf(null, initial, 0),
      predecessor: null,
      committedAt: Date.now(),
    };
    this.heads.set(branch, head);
    this.history.set(branch, [head]);
    return head;
  }

  head(branch: string): BranchHead | undefined {
    return this.heads.get(branch);
  }

  lineage(branch: string): BranchHead[] {
    return [...(this.history.get(branch) ?? [])];
  }

  /** Untrusted proposers call this — does not mutate. */
  propose(input: Omit<Proposal, "id">): Proposal {
    return { ...input, id: uid("prop") };
  }

  /**
   * Only path that advances authoritative state.
   * Revalidates predecessor, authority, and evidence atomically.
   */
  commit(proposal: Proposal): CommitResult {
    const head = this.heads.get(proposal.branch);
    if (!head) {
      return {
        disposition: "reject",
        reason: `unknown branch: ${proposal.branch}`,
        proposalId: proposal.id,
      };
    }

    // Exact predecessor — kills stale retries / concurrent writers
    if (proposal.predecessor !== head.id) {
      return {
        disposition: "reject",
        reason: `stale predecessor: got ${proposal.predecessor}, need ${head.id}`,
        proposalId: proposal.id,
      };
    }

    // Authority — proposer cannot inject privileges into patch to self-authorize
    for (const req of proposal.requires ?? []) {
      if (!this.authorities.has(req)) {
        return {
          disposition: "reject",
          reason: `missing authority: ${req}`,
          proposalId: proposal.id,
        };
      }
    }

    // Evidence
    for (const ev of proposal.evidence ?? [{ type: "always" as const }]) {
      const verdict = this.checkEvidence(ev, head.state, proposal.patch);
      if (verdict === "defer") {
        return {
          disposition: "defer",
          reason: `evidence deferred: ${JSON.stringify(ev)}`,
          proposalId: proposal.id,
        };
      }
      if (verdict === false) {
        return {
          disposition: "reject",
          reason: `evidence failed: ${JSON.stringify(ev)}`,
          proposalId: proposal.id,
        };
      }
    }

    const nextState = { ...head.state, ...proposal.patch };
    // Strip any attempt to smuggle authorities via state
    delete (nextState as { __authorities?: unknown }).__authorities;

    const next: BranchHead = {
      id: uid("head"),
      branch: proposal.branch,
      seq: head.seq + 1,
      state: nextState,
      receipt: receiptOf(head.id, nextState, head.seq + 1),
      predecessor: head.id,
      committedAt: Date.now(),
    };

    this.heads.set(proposal.branch, next);
    this.history.get(proposal.branch)!.push(next);

    return {
      disposition: "accept",
      reason: "ok",
      head: next,
      proposalId: proposal.id,
    };
  }

  private checkEvidence(
    ev: Evidence,
    state: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): boolean | "defer" {
    switch (ev.type) {
      case "always":
        return true;
      case "absent_key":
        return state[ev.key] === undefined;
      case "predicate": {
        const fn = this.predicates.get(ev.name);
        if (!fn) return "defer";
        return fn(state, patch);
      }
      default:
        return false;
    }
  }
}

export function createKernel(): ContinuityKernel {
  return new ContinuityKernel();
}
