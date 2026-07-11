import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A shared SQLite-backed reproduction of CAP's own order lifecycle, using the
 * exact field names and status values from @croo-network/sdk's real types
 * (Negotiation, Order, Delivery). Every agent process opens the same file, so
 * this behaves like a real backend shared across independently-running
 * services - not an in-memory stub local to one process.
 *
 * Field/status names are copied 1:1 from node_modules/@croo-network/sdk so
 * that SimAgentClient (which reads and writes through this store) is
 * structurally interchangeable with the real AgentClient.
 */

export interface SimNegotiationRow {
  negotiationId: string;
  serviceId: string;
  requesterAgentId: string;
  providerAgentId: string;
  requirements: string;
  status: string; // pending | accepted | rejected | expired
  rejectReason: string;
  metadata: string;
  expiresAt: string;
  createdTime: string;
  updatedTime: string;
}

export interface SimOrderRow {
  orderId: string;
  negotiationId: string;
  serviceId: string;
  requesterAgentId: string;
  providerAgentId: string;
  price: string;
  paymentToken: string;
  status: string; // created | paid | completed | rejected | expired
  rejectReason: string;
  payTxHash: string;
  deliverTxHash: string;
  clearTxHash: string;
  createdTime: string;
  updatedTime: string;
  paidAt: string;
  deliveredAt: string;
}

export interface SimDeliveryRow {
  deliveryId: string;
  orderId: string;
  providerAgentId: string;
  deliverableType: string;
  deliverableSchema: string;
  deliverableText: string;
  contentHash: string;
  status: string; // submitted | accepted | rejected
  submittedAt: string;
  verifiedAt: string;
}

/** serviceId -> which agent identity owns it, and what it's priced at. Stands in for CROO Dashboard service registration in simulated mode. */
export interface ServiceDirectoryEntry {
  providerAgentId: string;
  priceUsdc: string;
}

const directory = new Map<string, ServiceDirectoryEntry>();

export function registerService(serviceId: string, entry: ServiceDirectoryEntry): void {
  directory.set(serviceId, entry);
}

export function lookupService(serviceId: string): ServiceDirectoryEntry {
  const entry = directory.get(serviceId);
  if (!entry) {
    throw new Error(
      `Unknown service "${serviceId}" in the simulated directory. Call registerService() during startup.`,
    );
  }
  return entry;
}

let sharedDb: Database.Database | null = null;

export function openSimStore(path: string): Database.Database {
  if (sharedDb) return sharedDb;
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS negotiations (
      negotiationId TEXT PRIMARY KEY,
      serviceId TEXT NOT NULL,
      requesterAgentId TEXT NOT NULL,
      providerAgentId TEXT NOT NULL,
      requirements TEXT NOT NULL,
      status TEXT NOT NULL,
      rejectReason TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '',
      expiresAt TEXT NOT NULL,
      createdTime TEXT NOT NULL,
      updatedTime TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      orderId TEXT PRIMARY KEY,
      negotiationId TEXT NOT NULL,
      serviceId TEXT NOT NULL,
      requesterAgentId TEXT NOT NULL,
      providerAgentId TEXT NOT NULL,
      price TEXT NOT NULL,
      paymentToken TEXT NOT NULL DEFAULT 'USDC',
      status TEXT NOT NULL,
      rejectReason TEXT NOT NULL DEFAULT '',
      payTxHash TEXT NOT NULL DEFAULT '',
      deliverTxHash TEXT NOT NULL DEFAULT '',
      clearTxHash TEXT NOT NULL DEFAULT '',
      createdTime TEXT NOT NULL,
      updatedTime TEXT NOT NULL,
      paidAt TEXT NOT NULL DEFAULT '',
      deliveredAt TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      deliveryId TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      providerAgentId TEXT NOT NULL,
      deliverableType TEXT NOT NULL,
      deliverableSchema TEXT NOT NULL DEFAULT '',
      deliverableText TEXT NOT NULL DEFAULT '',
      contentHash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      submittedAt TEXT NOT NULL,
      verifiedAt TEXT NOT NULL DEFAULT ''
    );

    -- Every row an agent has already reacted to, so the polling loop that
    -- stands in for push events never re-delivers the same transition twice.
    CREATE TABLE IF NOT EXISTS seen_events (
      agentId TEXT NOT NULL,
      eventKey TEXT NOT NULL,
      PRIMARY KEY (agentId, eventKey)
    );
  `);
  sharedDb = db;
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
