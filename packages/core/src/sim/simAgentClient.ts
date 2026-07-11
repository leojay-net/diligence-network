import type Database from "better-sqlite3";
import { createLogger } from "../logger.js";
import {
  lookupService,
  newId,
  openSimStore,
  type SimDeliveryRow,
  type SimNegotiationRow,
  type SimOrderRow,
} from "./simStore.js";
import type {
  CapAgentClient,
  CapEvent,
  CapEventStream,
  DeliverOrderRequest,
  DeliverOrderResult,
  ListOptions,
  Negotiation,
  NegotiateOrderRequest,
  AcceptNegotiationResult,
  Order,
  PayOrderResult,
  Delivery,
} from "../capClient.js";

const logger = createLogger("sim-agent-client");
const POLL_INTERVAL_MS = 400;
const NEGOTIATION_TTL_MS = 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function toNegotiation(row: SimNegotiationRow): Negotiation {
  return {
    negotiationId: row.negotiationId,
    serviceId: row.serviceId,
    requesterAgentId: row.requesterAgentId,
    providerAgentId: row.providerAgentId,
    requirements: row.requirements,
    status: row.status,
    rejectReason: row.rejectReason,
    metadata: row.metadata,
    expiresAt: row.expiresAt,
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  };
}

function toOrder(row: SimOrderRow): Order {
  return {
    orderId: row.orderId,
    negotiationId: row.negotiationId,
    chainOrderId: row.orderId,
    serviceId: row.serviceId,
    requesterAgentId: row.requesterAgentId,
    providerAgentId: row.providerAgentId,
    buyerUserId: row.requesterAgentId,
    requesterWalletAddress: "",
    providerWalletAddress: "",
    price: row.price,
    paymentToken: row.paymentToken,
    deliveryWindow: 0,
    status: row.status,
    rejectReason: row.rejectReason,
    createTxHash: "",
    payTxHash: row.payTxHash,
    deliverTxHash: row.deliverTxHash,
    rejectTxHash: "",
    clearTxHash: row.clearTxHash,
    slaDeadline: "",
    payDeadline: "",
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
    createdAt: row.createdTime,
    paidAt: row.paidAt,
    deliveredAt: row.deliveredAt,
    rejectedAt: "",
    expiredAt: "",
  };
}

function toDelivery(row: SimDeliveryRow): Delivery {
  return {
    deliveryId: row.deliveryId,
    orderId: row.orderId,
    providerAgentId: row.providerAgentId,
    deliverableType: row.deliverableType,
    deliverableSchema: row.deliverableSchema,
    deliverableText: row.deliverableText,
    contentHash: row.contentHash,
    status: row.status,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    createdTime: row.submittedAt,
    updatedTime: row.verifiedAt || row.submittedAt,
  };
}

/**
 * A drop-in stand-in for @croo-network/sdk's AgentClient. Implements the same
 * public surface (see CapAgentClient in capClient.ts) against a shared SQLite
 * file instead of the real network, reproducing the full negotiate -> accept
 * -> pay -> deliver -> clear lifecycle with the same field names and status
 * values as the real SDK's types. Agent code written against CapAgentClient
 * never knows which implementation it's talking to.
 */
export class SimAgentClient implements CapAgentClient {
  private readonly db: Database.Database;

  constructor(private readonly simAgentId: string, dbPath: string) {
    this.db = openSimStore(dbPath);
  }

  async negotiateOrder(req: NegotiateOrderRequest): Promise<Negotiation> {
    const service = lookupService(req.serviceId);
    const negotiationId = newId("neg");
    const now = nowIso();
    const row: SimNegotiationRow = {
      negotiationId,
      serviceId: req.serviceId,
      requesterAgentId: req.requesterAgentId ?? this.simAgentId,
      providerAgentId: service.providerAgentId,
      requirements: req.requirements ?? "",
      status: "pending",
      rejectReason: "",
      metadata: req.metadata ?? "",
      expiresAt: new Date(Date.now() + NEGOTIATION_TTL_MS).toISOString(),
      createdTime: now,
      updatedTime: now,
    };
    this.db
      .prepare(
        `INSERT INTO negotiations (negotiationId, serviceId, requesterAgentId, providerAgentId, requirements, status, rejectReason, metadata, expiresAt, createdTime, updatedTime)
         VALUES (@negotiationId, @serviceId, @requesterAgentId, @providerAgentId, @requirements, @status, @rejectReason, @metadata, @expiresAt, @createdTime, @updatedTime)`,
      )
      .run(row);
    logger.debug("negotiation created", { negotiationId, serviceId: req.serviceId });
    return toNegotiation(row);
  }

  async acceptNegotiation(negotiationId: string): Promise<AcceptNegotiationResult> {
    const negotiation = await this.getNegotiation(negotiationId);
    if (negotiation.providerAgentId !== this.simAgentId) {
      throw new Error(`Agent ${this.simAgentId} is not the provider for negotiation ${negotiationId}`);
    }
    if (negotiation.status !== "pending") {
      throw new Error(`Negotiation ${negotiationId} is not pending (status=${negotiation.status})`);
    }
    const service = lookupService(negotiation.serviceId);
    const orderId = newId("order");
    const now = nowIso();
    const orderRow: SimOrderRow = {
      orderId,
      negotiationId,
      serviceId: negotiation.serviceId,
      requesterAgentId: negotiation.requesterAgentId,
      providerAgentId: negotiation.providerAgentId,
      price: service.priceUsdc,
      paymentToken: "USDC",
      status: "created",
      rejectReason: "",
      payTxHash: "",
      deliverTxHash: "",
      clearTxHash: "",
      createdTime: now,
      updatedTime: now,
      paidAt: "",
      deliveredAt: "",
    };
    this.db
      .prepare(
        `INSERT INTO orders (orderId, negotiationId, serviceId, requesterAgentId, providerAgentId, price, paymentToken, status, rejectReason, payTxHash, deliverTxHash, clearTxHash, createdTime, updatedTime, paidAt, deliveredAt)
         VALUES (@orderId, @negotiationId, @serviceId, @requesterAgentId, @providerAgentId, @price, @paymentToken, @status, @rejectReason, @payTxHash, @deliverTxHash, @clearTxHash, @createdTime, @updatedTime, @paidAt, @deliveredAt)`,
      )
      .run(orderRow);
    // Negotiation carries no orderId field (matching the real SDK's own
    // Negotiation type) - the caller learns the order's ID from this method's
    // return value or from the OrderCreated event, never by re-reading the
    // negotiation.
    this.db
      .prepare(`UPDATE negotiations SET status = 'accepted', updatedTime = ? WHERE negotiationId = ?`)
      .run(now, negotiationId);
    logger.debug("negotiation accepted, order created", { negotiationId, orderId });
    const updatedNegotiation = await this.getNegotiation(negotiationId);
    return { negotiation: updatedNegotiation, order: toOrder(orderRow) };
  }

  async acceptNegotiationWithFundAddress(negotiationId: string): Promise<AcceptNegotiationResult> {
    // None of this network's services declare require_fund_transfer=true, so
    // this collapses to the plain accept path.
    return this.acceptNegotiation(negotiationId);
  }

  async rejectNegotiation(negotiationId: string, reason: string): Promise<void> {
    const negotiation = await this.getNegotiation(negotiationId);
    if (negotiation.providerAgentId !== this.simAgentId) {
      throw new Error(`Agent ${this.simAgentId} is not the provider for negotiation ${negotiationId}`);
    }
    this.db
      .prepare(
        `UPDATE negotiations SET status = 'rejected', rejectReason = ?, updatedTime = ? WHERE negotiationId = ?`,
      )
      .run(reason, nowIso(), negotiationId);
  }

  async getNegotiation(negotiationId: string): Promise<Negotiation> {
    const row = this.db
      .prepare(`SELECT * FROM negotiations WHERE negotiationId = ?`)
      .get(negotiationId) as SimNegotiationRow | undefined;
    if (!row) throw new Error(`Unknown negotiation ${negotiationId}`);
    return toNegotiation(row);
  }

  async listNegotiations(opts?: ListOptions): Promise<Negotiation[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.role === "provider") {
      clauses.push("providerAgentId = ?");
      params.push(this.simAgentId);
    } else if (opts?.role === "requester") {
      clauses.push("requesterAgentId = ?");
      params.push(this.simAgentId);
    } else {
      clauses.push("(providerAgentId = ? OR requesterAgentId = ?)");
      params.push(this.simAgentId, this.simAgentId);
    }
    if (opts?.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM negotiations ${where} ORDER BY createdTime DESC`)
      .all(...params) as SimNegotiationRow[];
    return rows.map(toNegotiation);
  }

  async getOrder(orderId: string): Promise<Order> {
    const row = this.db.prepare(`SELECT * FROM orders WHERE orderId = ?`).get(orderId) as
      | SimOrderRow
      | undefined;
    if (!row) throw new Error(`Unknown order ${orderId}`);
    return toOrder(row);
  }

  async listOrders(opts?: ListOptions): Promise<Order[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.role === "provider") {
      clauses.push("providerAgentId = ?");
      params.push(this.simAgentId);
    } else if (opts?.role === "requester") {
      clauses.push("requesterAgentId = ?");
      params.push(this.simAgentId);
    } else {
      clauses.push("(providerAgentId = ? OR requesterAgentId = ?)");
      params.push(this.simAgentId, this.simAgentId);
    }
    if (opts?.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM orders ${where} ORDER BY createdTime DESC`)
      .all(...params) as SimOrderRow[];
    return rows.map(toOrder);
  }

  async payOrder(orderId: string): Promise<PayOrderResult> {
    const order = await this.getOrder(orderId);
    if (order.requesterAgentId !== this.simAgentId) {
      throw new Error(`Agent ${this.simAgentId} is not the requester for order ${orderId}`);
    }
    if (order.status !== "created") {
      throw new Error(`Order ${orderId} cannot be paid from status ${order.status}`);
    }
    const txHash = newId("simtx");
    const now = nowIso();
    this.db
      .prepare(`UPDATE orders SET status = 'paid', paidAt = ?, payTxHash = ?, updatedTime = ? WHERE orderId = ?`)
      .run(now, txHash, now, orderId);
    logger.debug("order paid", { orderId, txHash });
    return { order: await this.getOrder(orderId), txHash };
  }

  async deliverOrder(orderId: string, req: DeliverOrderRequest): Promise<DeliverOrderResult> {
    const order = await this.getOrder(orderId);
    if (order.providerAgentId !== this.simAgentId) {
      throw new Error(`Agent ${this.simAgentId} is not the provider for order ${orderId}`);
    }
    if (order.status !== "paid") {
      throw new Error(`Order ${orderId} cannot be delivered from status ${order.status}`);
    }
    const content = req.deliverableText ?? req.deliverableSchema ?? "";
    if (!content.trim()) {
      // Mirrors "no proof, no payment": an empty delivery is rejected outright
      // rather than silently clearing, the same way an invalid submission to
      // the real API would come back as an APIError.
      throw new Error(`Refusing to deliver order ${orderId} with an empty deliverable`);
    }

    const deliveryId = newId("delivery");
    const now = nowIso();
    const deliveryRow: SimDeliveryRow = {
      deliveryId,
      orderId,
      providerAgentId: this.simAgentId,
      deliverableType: req.deliverableType,
      deliverableSchema: req.deliverableSchema ?? "",
      deliverableText: req.deliverableText ?? "",
      contentHash: newId("hash"),
      status: "accepted",
      submittedAt: now,
      verifiedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO deliveries (deliveryId, orderId, providerAgentId, deliverableType, deliverableSchema, deliverableText, contentHash, status, submittedAt, verifiedAt)
         VALUES (@deliveryId, @orderId, @providerAgentId, @deliverableType, @deliverableSchema, @deliverableText, @contentHash, @status, @submittedAt, @verifiedAt)`,
      )
      .run(deliveryRow);

    const txHash = newId("simtx");
    this.db
      .prepare(
        `UPDATE orders SET status = 'completed', deliveredAt = ?, deliverTxHash = ?, clearTxHash = ?, updatedTime = ? WHERE orderId = ?`,
      )
      .run(now, txHash, newId("simtx"), now, orderId);
    logger.debug("order delivered and cleared", { orderId, deliveryId });
    return { order: await this.getOrder(orderId), delivery: toDelivery(deliveryRow), txHash };
  }

  async rejectOrder(orderId: string, reason: string): Promise<void> {
    const order = await this.getOrder(orderId);
    if (order.providerAgentId !== this.simAgentId) {
      throw new Error(`Agent ${this.simAgentId} is not the provider for order ${orderId}`);
    }
    this.db
      .prepare(`UPDATE orders SET status = 'rejected', rejectReason = ?, updatedTime = ? WHERE orderId = ?`)
      .run(reason, nowIso(), orderId);
  }

  async getDelivery(orderId: string): Promise<Delivery> {
    const row = this.db.prepare(`SELECT * FROM deliveries WHERE orderId = ?`).get(orderId) as
      | SimDeliveryRow
      | undefined;
    if (!row) throw new Error(`No delivery for order ${orderId}`);
    return toDelivery(row);
  }

  async connectWebSocket(): Promise<CapEventStream> {
    const handlers = new Map<string, Array<(e: CapEvent) => void>>();
    const anyHandlers: Array<(e: CapEvent) => void> = [];
    const agentId = this.simAgentId;
    const db = this.db;

    const markSeen = (eventKey: string): boolean => {
      try {
        db.prepare(`INSERT INTO seen_events (agentId, eventKey) VALUES (?, ?)`).run(agentId, eventKey);
        return true; // newly seen
      } catch {
        return false; // already seen (primary key collision)
      }
    };

    const dispatch = (event: CapEvent): void => {
      for (const handler of handlers.get(event.type) ?? []) handler(event);
      for (const handler of anyHandlers) handler(event);
    };

    const poll = (): void => {
      const pendingNegotiations = db
        .prepare(`SELECT * FROM negotiations WHERE providerAgentId = ? AND status = 'pending'`)
        .all(agentId) as SimNegotiationRow[];
      for (const row of pendingNegotiations) {
        if (markSeen(`neg-created:${row.negotiationId}`)) {
          dispatch({
            type: "order_negotiation_created",
            raw: row as unknown as Record<string, unknown>,
            negotiation_id: row.negotiationId,
            service_id: row.serviceId,
            requester_agent_id: row.requesterAgentId,
            provider_agent_id: row.providerAgentId,
            status: row.status,
          });
        }
      }

      const createdOrders = db
        .prepare(`SELECT * FROM orders WHERE requesterAgentId = ? AND status = 'created'`)
        .all(agentId) as SimOrderRow[];
      for (const row of createdOrders) {
        if (markSeen(`order-created:${row.orderId}`)) {
          dispatch({
            type: "order_created",
            raw: row as unknown as Record<string, unknown>,
            order_id: row.orderId,
            negotiation_id: row.negotiationId,
            service_id: row.serviceId,
            requester_agent_id: row.requesterAgentId,
            provider_agent_id: row.providerAgentId,
            status: row.status,
          });
        }
      }

      const paidOrders = db
        .prepare(`SELECT * FROM orders WHERE providerAgentId = ? AND status = 'paid'`)
        .all(agentId) as SimOrderRow[];
      for (const row of paidOrders) {
        if (markSeen(`order-paid:${row.orderId}`)) {
          dispatch({
            type: "order_paid",
            raw: row as unknown as Record<string, unknown>,
            order_id: row.orderId,
            negotiation_id: row.negotiationId,
            service_id: row.serviceId,
            requester_agent_id: row.requesterAgentId,
            provider_agent_id: row.providerAgentId,
            status: row.status,
          });
        }
      }

      const completedOrders = db
        .prepare(`SELECT * FROM orders WHERE requesterAgentId = ? AND status = 'completed'`)
        .all(agentId) as SimOrderRow[];
      for (const row of completedOrders) {
        if (markSeen(`order-completed:${row.orderId}`)) {
          dispatch({
            type: "order_completed",
            raw: row as unknown as Record<string, unknown>,
            order_id: row.orderId,
            negotiation_id: row.negotiationId,
            service_id: row.serviceId,
            requester_agent_id: row.requesterAgentId,
            provider_agent_id: row.providerAgentId,
            status: row.status,
          });
        }
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    poll();

    return {
      on(type: string, handler: (e: CapEvent) => void) {
        const list = handlers.get(type) ?? [];
        list.push(handler);
        handlers.set(type, list);
      },
      onAny(handler: (e: CapEvent) => void) {
        anyHandlers.push(handler);
      },
      close() {
        clearInterval(interval);
      },
    };
  }
}
