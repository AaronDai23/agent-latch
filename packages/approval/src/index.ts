/**
 * agent-latch-approval — Approval Integrity
 *
 * Invariant: a human approval binds to an exact tool payload (canonical hash).
 * If args drift after approval, the call does not run.
 */

import { createHash } from "node:crypto";

export type TicketStatus = "pending" | "approved" | "rejected" | "used" | "expired";

export interface ApprovalTicket {
  id: string;
  tool: string;
  /** Canonical JSON of the approved args. */
  snapshot: Record<string, unknown>;
  hash: string;
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  /** Optional expiry (epoch ms). */
  expiresAt?: number;
}

export type ApprovalDecision = "propose" | "approve" | "reject" | "allow" | "deny" | "drift";

export interface ApprovalEntry {
  id: string;
  ts: number;
  tool: string;
  ticketId: string;
  decision: ApprovalDecision;
  hash?: string;
  reason?: string;
  args: Record<string, unknown>;
}

export interface ApprovalSummary {
  total: number;
  propose: number;
  approve: number;
  reject: number;
  allow: number;
  deny: number;
  drift: number;
  byTool: Record<
    string,
    {
      propose: number;
      approve: number;
      reject: number;
      allow: number;
      deny: number;
      drift: number;
    }
  >;
}

export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

function uid(): string {
  return `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): number {
  return Date.now();
}

/** Stable JSON stringify: sorted object keys, no undefined. */
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

export function payloadHash(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(args)).digest("hex").slice(0, 16);
}

/** Strip control fields agents may attach when redeeming a ticket. */
export function stripApprovalMeta(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const { __approvalTicketId, __ticketId, ticketId, ...rest } = args;
  void __approvalTicketId;
  void __ticketId;
  void ticketId;
  return rest;
}

export function extractTicketId(args: Record<string, unknown>): string | undefined {
  const raw =
    args.__approvalTicketId ?? args.__ticketId ?? args.ticketId;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export class ApprovalLog {
  private readonly entries: ApprovalEntry[] = [];
  private listener?: (entry: ApprovalEntry) => void;

  on(listener: (entry: ApprovalEntry) => void): this {
    this.listener = listener;
    return this;
  }

  record(
    partial: Omit<ApprovalEntry, "id" | "ts"> & { id?: string; ts?: number },
  ): ApprovalEntry {
    const entry: ApprovalEntry = {
      ...partial,
      id: partial.id ?? uid(),
      ts: partial.ts ?? now(),
    };
    this.entries.push(entry);
    this.listener?.(entry);
    return entry;
  }

  list(filter?: { tool?: string; decision?: ApprovalDecision }): ApprovalEntry[] {
    return this.entries.filter((e) => {
      if (filter?.tool && e.tool !== filter.tool) return false;
      if (filter?.decision && e.decision !== filter.decision) return false;
      return true;
    });
  }

  summary(): ApprovalSummary {
    const byTool: ApprovalSummary["byTool"] = {};
    const out: ApprovalSummary = {
      total: 0,
      propose: 0,
      approve: 0,
      reject: 0,
      allow: 0,
      deny: 0,
      drift: 0,
      byTool,
    };
    for (const e of this.entries) {
      out.total++;
      out[e.decision]++;
      const slot = (byTool[e.tool] ??= {
        propose: 0,
        approve: 0,
        reject: 0,
        allow: 0,
        deny: 0,
        drift: 0,
      });
      slot[e.decision]++;
    }
    return out;
  }

  print(): string {
    const s = this.summary();
    const head = `approval: ${s.allow} allow / ${s.deny} deny / ${s.drift} drift / ${s.propose} propose (total ${s.total})`;
    const lines = this.entries.map((e) => {
      const reason = e.reason ? ` — ${e.reason}` : "";
      return `${new Date(e.ts).toISOString()}  ${e.decision.padEnd(7)}  ${e.tool.padEnd(16)} ticket=${e.ticketId}${reason}`;
    });
    const text = [head, ...lines].join("\n");
    console.log(text);
    return text;
  }
}

export interface ProposeOptions {
  expiresInMs?: number;
  reason?: string;
}

export interface ApproveOptions {
  by: string;
  reason?: string;
}

export interface RejectOptions {
  by: string;
  reason?: string;
}

export class ApprovalRegistry {
  readonly log = new ApprovalLog();
  private readonly tickets = new Map<string, ApprovalTicket>();

  listTickets(filter?: { status?: TicketStatus; tool?: string }): ApprovalTicket[] {
    return [...this.tickets.values()].filter((t) => {
      if (filter?.status && t.status !== filter.status) return false;
      if (filter?.tool && t.tool !== filter.tool) return false;
      return true;
    });
  }

  get(ticketId: string): ApprovalTicket | undefined {
    return this.tickets.get(ticketId);
  }

  /** Create a pending approval bound to the exact args snapshot. */
  propose(
    tool: string,
    args: Record<string, unknown>,
    opts: ProposeOptions = {},
  ): ApprovalTicket {
    const snapshot = structuredClone(stripApprovalMeta(args)) as Record<string, unknown>;
    const hash = payloadHash(snapshot);
    const ts = now();
    const ticket: ApprovalTicket = {
      id: uid(),
      tool,
      snapshot,
      hash,
      status: "pending",
      createdAt: ts,
      updatedAt: ts,
    };
    if (opts.expiresInMs !== undefined) {
      ticket.expiresAt = ts + opts.expiresInMs;
    }
    if (opts.reason !== undefined) ticket.reason = opts.reason;
    this.tickets.set(ticket.id, ticket);
    const proposeEntry: Omit<ApprovalEntry, "id" | "ts"> = {
      tool,
      ticketId: ticket.id,
      decision: "propose",
      hash,
      args: snapshot,
    };
    if (opts.reason !== undefined) proposeEntry.reason = opts.reason;
    this.log.record(proposeEntry);
    return ticket;
  }

  approve(ticketId: string, opts: ApproveOptions): ApprovalTicket {
    const ticket = this.require(ticketId);
    this.ensureFresh(ticket);
    if (ticket.status !== "pending") {
      throw new ApprovalError(`Ticket ${ticketId} is ${ticket.status}, cannot approve`, {
        ticketId,
        status: ticket.status,
      });
    }
    ticket.status = "approved";
    ticket.approvedBy = opts.by;
    ticket.updatedAt = now();
    if (opts.reason !== undefined) ticket.reason = opts.reason;
    this.log.record({
      tool: ticket.tool,
      ticketId,
      decision: "approve",
      hash: ticket.hash,
      args: ticket.snapshot,
      reason: opts.reason ?? `approved by ${opts.by}`,
    });
    return ticket;
  }

  reject(ticketId: string, opts: RejectOptions): ApprovalTicket {
    const ticket = this.require(ticketId);
    if (ticket.status !== "pending" && ticket.status !== "approved") {
      throw new ApprovalError(`Ticket ${ticketId} is ${ticket.status}, cannot reject`, {
        ticketId,
        status: ticket.status,
      });
    }
    ticket.status = "rejected";
    ticket.rejectedBy = opts.by;
    ticket.updatedAt = now();
    if (opts.reason !== undefined) ticket.reason = opts.reason;
    this.log.record({
      tool: ticket.tool,
      ticketId,
      decision: "reject",
      hash: ticket.hash,
      args: ticket.snapshot,
      reason: opts.reason ?? `rejected by ${opts.by}`,
    });
    return ticket;
  }

  /**
   * Verify current args match the approved snapshot. Marks ticket used.
   * Throws on missing / wrong status / expiry / hash drift.
   */
  redeem(
    ticketId: string,
    tool: string,
    args: Record<string, unknown>,
  ): ApprovalTicket {
    const ticket = this.require(ticketId);
    this.ensureFresh(ticket);

    if (ticket.tool !== tool) {
      this.log.record({
        tool,
        ticketId,
        decision: "deny",
        args,
        reason: `Ticket tool mismatch: expected ${ticket.tool}`,
      });
      throw new ApprovalError(`Ticket ${ticketId} is for ${ticket.tool}, not ${tool}`, {
        ticketId,
        expectedTool: ticket.tool,
        tool,
      });
    }

    if (ticket.status !== "approved") {
      this.log.record({
        tool,
        ticketId,
        decision: "deny",
        args,
        reason: `Ticket status is ${ticket.status}`,
      });
      throw new ApprovalError(`Ticket ${ticketId} is ${ticket.status}, not approved`, {
        ticketId,
        status: ticket.status,
      });
    }

    const current = stripApprovalMeta(args);
    const hash = payloadHash(current);
    if (hash !== ticket.hash) {
      this.log.record({
        tool,
        ticketId,
        decision: "drift",
        hash,
        args: current,
        reason: `Payload drift: approved=${ticket.hash} current=${hash}`,
      });
      throw new ApprovalError(
        `Approval drift for ${tool}: payload no longer matches approved snapshot`,
        {
          ticketId,
          approvedHash: ticket.hash,
          currentHash: hash,
          approved: ticket.snapshot,
          current,
        },
      );
    }

    ticket.status = "used";
    ticket.updatedAt = now();
    this.log.record({
      tool,
      ticketId,
      decision: "allow",
      hash,
      args: current,
      reason: `redeemed; approved by ${ticket.approvedBy ?? "unknown"}`,
    });
    return ticket;
  }

  /** Soft check without consuming the ticket. */
  matches(ticketId: string, args: Record<string, unknown>): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;
    if (ticket.expiresAt !== undefined && now() > ticket.expiresAt) return false;
    return payloadHash(stripApprovalMeta(args)) === ticket.hash;
  }

  private require(ticketId: string): ApprovalTicket {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new ApprovalError(`Unknown approval ticket: ${ticketId}`, { ticketId });
    }
    return ticket;
  }

  private ensureFresh(ticket: ApprovalTicket): void {
    if (ticket.expiresAt !== undefined && now() > ticket.expiresAt) {
      ticket.status = "expired";
      ticket.updatedAt = now();
      throw new ApprovalError(`Ticket ${ticket.id} expired`, {
        ticketId: ticket.id,
        expiresAt: ticket.expiresAt,
      });
    }
  }

  summary(): ApprovalSummary {
    return this.log.summary();
  }

  print(): string {
    return this.log.print();
  }
}

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export interface WrapApprovalOptions {
  /** Which tools require a redeemed approval ticket. */
  needsApproval?: (tool: string, args: Record<string, unknown>) => boolean;
  /**
   * When a gated tool is called without a ticket id, auto-propose and return
   * this shape instead of executing. Default: return needs_approval envelope.
   */
  onNeedsApproval?: (
    ticket: ApprovalTicket,
    tool: string,
    args: Record<string, unknown>,
  ) => unknown;
  onDenied?: (err: ApprovalError, tool: string, args: Record<string, unknown>) => unknown;
}

export interface NeedsApprovalEnvelope {
  ok: false;
  error_kind: "needs_approval";
  tool: string;
  ticketId: string;
  hash: string;
  snapshot: Record<string, unknown>;
  message: string;
}

/**
 * Wrap tools that require approval integrity.
 *
 * - No ticket id → propose + return needs_approval (does not execute)
 * - With ticket id → redeem (hash check) then execute
 */
export function wrapApproval(
  registry: ApprovalRegistry,
  tools: Record<string, ToolHandler>,
  opts: WrapApprovalOptions = {},
): Record<string, ToolHandler> {
  const needs =
    opts.needsApproval ??
    ((_tool: string, _args: Record<string, unknown>) => true);

  const out: Record<string, ToolHandler> = {};
  for (const [name, handler] of Object.entries(tools)) {
    out[name] = async (args) => {
      const plain = args ?? {};
      if (!needs(name, plain)) {
        return handler(plain);
      }

      const ticketId = extractTicketId(plain);
      if (!ticketId) {
        const ticket = registry.propose(name, plain);
        if (opts.onNeedsApproval) return opts.onNeedsApproval(ticket, name, plain);
        const env: NeedsApprovalEnvelope = {
          ok: false,
          error_kind: "needs_approval",
          tool: name,
          ticketId: ticket.id,
          hash: ticket.hash,
          snapshot: ticket.snapshot,
          message: `Approval required for ${name}. Approve ticket ${ticket.id} then retry with ticketId.`,
        };
        return env;
      }

      try {
        registry.redeem(ticketId, name, plain);
      } catch (e) {
        if (e instanceof ApprovalError && opts.onDenied) {
          return opts.onDenied(e, name, plain);
        }
        throw e;
      }

      return handler(stripApprovalMeta(plain));
    };
  }
  return out;
}

export function approvalTool(
  registry: ApprovalRegistry,
  toolName: string,
  execute: ToolHandler,
  opts: WrapApprovalOptions = {},
): ToolHandler {
  const wrapped = wrapApproval(registry, { [toolName]: execute }, opts);
  const fn = wrapped[toolName];
  if (!fn) throw new Error(`approvalTool: failed to wrap ${toolName}`);
  return fn;
}

export function createApproval(): ApprovalRegistry {
  return new ApprovalRegistry();
}
