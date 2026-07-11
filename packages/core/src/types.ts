/**
 * Domain types shared by every agent in the network. These are independent of
 * both the CAP wire format (see capClient.ts) and the LLM provider (llm.ts).
 * The research/verification payload shapes live in schemas.ts as Zod schemas,
 * since those double as the model's structured-output constraint; this file
 * re-exports them alongside everything that isn't LLM output.
 */

import type { ClaimVerdict, ResearchFinding } from "./schemas.js";

export type USDCAmount = string; // decimal string, e.g. "1.250000" - never a float

export type SubTaskKind = "research" | "verification";

export interface SubTask {
  id: string;
  kind: SubTaskKind;
  /** The specific question this subtask must answer. */
  question: string;
  /** Input data from a prior subtask this one depends on (e.g. grader needs the finder's output). */
  dependsOn?: string[];
}

/**
 * One hop in the audit trail: who was hired, for what, and what came back.
 * Status values mirror CAP's own Order.status vocabulary (created/paid/
 * completed/rejected/expired) plus "failed" for anything that errored out
 * of the lifecycle (e.g. a thrown APIError) before reaching a terminal CAP
 * status.
 */
export interface AuditEntry {
  subtaskId: string;
  agentRole: "source-finder" | "claim-grader";
  serviceId: string;
  orderId: string;
  costUsdc: USDCAmount;
  startedAt: string;
  completedAt: string;
  status: "completed" | "rejected" | "expired" | "failed";
}

export interface DiligenceReport {
  subject: string;
  summary: string;
  findings: ResearchFinding[];
  verdicts: ClaimVerdict[];
  contradictions: string[];
  confidenceScore: number;
  audit: AuditEntry[];
  generatedAt: string;
}

// --- Local bookkeeping for the dashboard (see db.ts). Status values mirror
// CAP's own Order.status vocabulary, plus "negotiating" for the moment
// between negotiateOrder() and an order actually existing. ---

export type OrderLifecycleStatus =
  | "negotiating"
  | "created"
  | "paid"
  | "completed"
  | "rejected"
  | "expired"
  | "failed";

export interface OrderRecord {
  orderId: string;
  counterpartyServiceId: string;
  /** "buyer" if we are the requester paying out; "provider" if we are earning. */
  direction: "buyer" | "provider";
  serviceDescription: string;
  priceUsdc: USDCAmount;
  status: OrderLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  /** Free-form JSON payloads for request/response, kept for the audit trail and dashboard. */
  requestPayload: unknown;
  resultPayload?: unknown;
  errorMessage?: string;
}
