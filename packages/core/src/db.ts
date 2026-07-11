import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditEntry, OrderRecord } from "./types.js";

/**
 * Every order any agent in this network places or fulfills is recorded here,
 * on both sides of the relationship. This is the network's own reputation
 * ledger: since CAP does not expose a discovery/reputation API, we derive
 * trust from observed, verifiable settlement outcomes instead of a platform
 * feature that doesn't exist.
 */
export class DiligenceDB {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        counterparty_service_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('buyer','provider')),
        service_description TEXT NOT NULL,
        price_usdc TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        request_payload TEXT NOT NULL,
        result_payload TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subtask_id TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        service_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        cost_usdc TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        report_subject TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  upsertOrder(order: OrderRecord): void {
    this.db
      .prepare(
        `INSERT INTO orders (order_id, counterparty_service_id, direction, service_description, price_usdc, status, created_at, updated_at, request_payload, result_payload, error_message)
         VALUES (@orderId, @counterpartyServiceId, @direction, @serviceDescription, @priceUsdc, @status, @createdAt, @updatedAt, @requestPayload, @resultPayload, @errorMessage)
         ON CONFLICT(order_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at,
           result_payload = excluded.result_payload,
           error_message = excluded.error_message`,
      )
      .run({
        orderId: order.orderId,
        counterpartyServiceId: order.counterpartyServiceId,
        direction: order.direction,
        serviceDescription: order.serviceDescription,
        priceUsdc: order.priceUsdc,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        requestPayload: JSON.stringify(order.requestPayload),
        resultPayload: order.resultPayload ? JSON.stringify(order.resultPayload) : null,
        errorMessage: order.errorMessage ?? null,
      });
  }

  listOrders(limit = 200): OrderRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM orders ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      orderId: row.order_id as string,
      counterpartyServiceId: row.counterparty_service_id as string,
      direction: row.direction as "buyer" | "provider",
      serviceDescription: row.service_description as string,
      priceUsdc: row.price_usdc as string,
      status: row.status as OrderRecord["status"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      requestPayload: JSON.parse(row.request_payload as string),
      resultPayload: row.result_payload ? JSON.parse(row.result_payload as string) : undefined,
      errorMessage: (row.error_message as string | null) ?? undefined,
    }));
  }

  recordAuditEntry(entry: AuditEntry, reportSubject: string): void {
    this.db
      .prepare(
        `INSERT INTO audit_entries (subtask_id, agent_role, service_id, order_id, cost_usdc, started_at, completed_at, status, report_subject)
         VALUES (@subtaskId, @agentRole, @serviceId, @orderId, @costUsdc, @startedAt, @completedAt, @status, @reportSubject)`,
      )
      .run({ ...entry, reportSubject });
  }

  /** Our own reputation signal for a counterparty: completed vs. failed/rejected/expired history. */
  reputationFor(serviceId: string): { completed: number; failed: number } {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) AS failed
         FROM audit_entries WHERE service_id = ?`,
      )
      .get(serviceId) as { completed: number | null; failed: number | null };
    return { completed: row.completed ?? 0, failed: row.failed ?? 0 };
  }

  listAuditEntries(limit = 200): Array<AuditEntry & { reportSubject: string }> {
    const rows = this.db
      .prepare(`SELECT * FROM audit_entries ORDER BY id DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      subtaskId: row.subtask_id as string,
      agentRole: row.agent_role as AuditEntry["agentRole"],
      serviceId: row.service_id as string,
      orderId: row.order_id as string,
      costUsdc: row.cost_usdc as string,
      startedAt: row.started_at as string,
      completedAt: row.completed_at as string,
      status: row.status as AuditEntry["status"],
      reportSubject: row.report_subject as string,
    }));
  }

  getReport(id: string): { id: string; subject: string; payload: unknown; createdAt: string } | undefined {
    const row = this.db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      subject: row.subject as string,
      payload: JSON.parse(row.payload as string),
      createdAt: row.created_at as string,
    };
  }

  saveReport(id: string, subject: string, payload: unknown): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO reports (id, subject, payload, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, subject, JSON.stringify(payload), new Date().toISOString());
  }

  listReports(limit = 50): Array<{ id: string; subject: string; payload: unknown; createdAt: string }> {
    const rows = this.db
      .prepare(`SELECT * FROM reports ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      subject: row.subject as string,
      payload: JSON.parse(row.payload as string),
      createdAt: row.created_at as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}
