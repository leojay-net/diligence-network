import { createCapClient, DeliverableType, EventType, type CapEventStream } from "./capClient.js";
import type { DiligenceDB } from "./db.js";
import type { Logger } from "./logger.js";

/**
 * The CAP-facing harness shared by every provider agent in this network
 * (Source Finder, Claim Grader). It owns the order lifecycle wiring -
 * listening for negotiations, accepting or rejecting them, reacting to
 * payment, delivering, and persisting every hop for the dashboard - so each
 * agent only has to supply its own business logic: how to parse an incoming
 * request, how to do the work, and how to serialize the result.
 */
export interface ProviderRuntimeOptions<TRequest, TResult> {
  role: "source-finder" | "claim-grader";
  serviceId: string;
  sdkKey: string;
  serviceDescription: string;
  db: DiligenceDB;
  logger: Logger;
  /** Parse and validate the raw `requirements` string from the negotiation. Throw to decline the negotiation. */
  parseRequest: (requirements: string) => TRequest;
  /** Do the actual work once payment has cleared into escrow. */
  handle: (request: TRequest, context: { orderId: string; negotiationId: string }) => Promise<TResult>;
  /** Serialize the result into the CAP deliverable text. */
  serializeResult: (result: TResult) => string;
}

export interface RunningProvider {
  stop: () => void;
}

export async function runProviderService<TRequest, TResult>(
  opts: ProviderRuntimeOptions<TRequest, TResult>,
): Promise<RunningProvider> {
  const client = createCapClient({ sdkKey: opts.sdkKey, serviceId: opts.serviceId });
  const stream: CapEventStream = await client.connectWebSocket();

  stream.on(EventType.NegotiationCreated, async (event) => {
    const negotiationId = event.negotiation_id;
    if (!negotiationId) return;
    try {
      const negotiation = await client.getNegotiation(negotiationId);
      opts.parseRequest(negotiation.requirements); // throws on an invalid request
      const { order } = await client.acceptNegotiation(negotiationId);
      opts.logger.info("negotiation accepted", { negotiationId, orderId: order.orderId });
      opts.db.upsertOrder({
        orderId: order.orderId,
        counterpartyServiceId: order.requesterAgentId,
        direction: "provider",
        serviceDescription: opts.serviceDescription,
        priceUsdc: order.price,
        status: "created",
        createdAt: order.createdTime,
        updatedAt: order.updatedTime,
        requestPayload: negotiation.requirements,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "invalid request";
      opts.logger.warn("rejecting negotiation", { negotiationId, reason });
      await client.rejectNegotiation(negotiationId, reason).catch(() => undefined);
    }
  });

  stream.on(EventType.OrderPaid, async (event) => {
    const orderId = event.order_id;
    if (!orderId) return;
    const order = await client.getOrder(orderId);
    const startedAt = new Date().toISOString();
    opts.db.upsertOrder({
      orderId: order.orderId,
      counterpartyServiceId: order.requesterAgentId,
      direction: "provider",
      serviceDescription: opts.serviceDescription,
      priceUsdc: order.price,
      status: "paid",
      createdAt: order.createdTime,
      updatedAt: new Date().toISOString(),
      requestPayload: order.negotiationId,
    });

    try {
      const negotiation = await client.getNegotiation(order.negotiationId);
      const request = opts.parseRequest(negotiation.requirements);
      const result = await opts.handle(request, { orderId: order.orderId, negotiationId: order.negotiationId });
      const deliverableText = opts.serializeResult(result);
      await client.deliverOrder(order.orderId, {
        deliverableType: DeliverableType.Text,
        deliverableText,
      });
      opts.logger.info("order delivered", { orderId: order.orderId });
      opts.db.upsertOrder({
        orderId: order.orderId,
        counterpartyServiceId: order.requesterAgentId,
        direction: "provider",
        serviceDescription: opts.serviceDescription,
        priceUsdc: order.price,
        status: "completed",
        createdAt: order.createdTime,
        updatedAt: new Date().toISOString(),
        requestPayload: negotiation.requirements,
        resultPayload: result,
      });
      opts.db.recordAuditEntry(
        {
          subtaskId: order.negotiationId,
          agentRole: opts.role,
          serviceId: opts.serviceId,
          orderId: order.orderId,
          costUsdc: order.price,
          startedAt,
          completedAt: new Date().toISOString(),
          status: "completed",
        },
        opts.serviceDescription,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.logger.error("failed to deliver order", { orderId: order.orderId, error: message });
      opts.db.upsertOrder({
        orderId: order.orderId,
        counterpartyServiceId: order.requesterAgentId,
        direction: "provider",
        serviceDescription: opts.serviceDescription,
        priceUsdc: order.price,
        status: "failed",
        createdAt: order.createdTime,
        updatedAt: new Date().toISOString(),
        requestPayload: order.negotiationId,
        errorMessage: message,
      });
    }
  });

  opts.logger.info(`${opts.role} listening`, { serviceId: opts.serviceId });

  return {
    stop: () => stream.close(),
  };
}
