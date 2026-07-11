import { EventType, type CapAgentClient, type CapEvent, type CapEventStream, type Order } from "./capClient.js";
import type { Logger } from "./logger.js";

/**
 * The requester-side counterpart to providerRuntime.ts: wraps CAP's
 * event-driven negotiate -> pay -> deliver flow in a plain async function, so
 * the orchestrator's decomposition logic can just `await hire(...)` instead
 * of hand-rolling a promise/event bridge for every sub-order it places.
 *
 * One CapEventStream is shared across every concurrent hire() call - each
 * call filters the stream for the specific negotiation/order IDs it's
 * waiting on, so fanning out several hires in parallel (Promise.all) is safe.
 */

export interface HireRequest {
  serviceId: string;
  requirements: unknown; // JSON-serializable request body for the target service
  /** Time to wait for the negotiation to be accepted and the order to be created. */
  acceptTimeoutMs?: number;
  /** Time to wait for the paid order to be delivered. */
  deliveryTimeoutMs?: number;
}

export interface HireResult<T> {
  orderId: string;
  serviceId: string;
  priceUsdc: string;
  result: T;
}

function waitForEvent(
  stream: CapEventStream,
  predicate: (event: CapEvent) => boolean,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<CapEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    const handler = (event: CapEvent): void => {
      if (predicate(event)) {
        clearTimeout(timer);
        resolve(event);
      }
    };
    stream.onAny(handler);
  });
}

export class Hirer {
  constructor(
    private readonly client: CapAgentClient,
    private readonly stream: CapEventStream,
    private readonly logger: Logger,
  ) {}

  async hire<T>(request: HireRequest): Promise<HireResult<T>> {
    const acceptTimeoutMs = request.acceptTimeoutMs ?? 60_000;
    const deliveryTimeoutMs = request.deliveryTimeoutMs ?? 3 * 60_000;

    const negotiation = await this.client.negotiateOrder({
      serviceId: request.serviceId,
      requirements: JSON.stringify(request.requirements),
    });
    this.logger.info("negotiation started", { serviceId: request.serviceId, negotiationId: negotiation.negotiationId });

    const createdOrRejected = await waitForEvent(
      this.stream,
      (event) =>
        event.negotiation_id === negotiation.negotiationId &&
        (event.type === EventType.OrderCreated || event.type === EventType.NegotiationRejected),
      acceptTimeoutMs,
      `Timed out waiting for ${request.serviceId} to accept negotiation ${negotiation.negotiationId}`,
    );
    if (createdOrRejected.type === EventType.NegotiationRejected) {
      throw new Error(`${request.serviceId} rejected the negotiation: ${createdOrRejected.reason ?? "no reason given"}`);
    }

    const orderId = createdOrRejected.order_id;
    if (!orderId) throw new Error(`OrderCreated event for negotiation ${negotiation.negotiationId} carried no order_id`);

    const order: Order = await this.client.getOrder(orderId);
    await this.client.payOrder(orderId);
    this.logger.info("order paid", { orderId, serviceId: request.serviceId, price: order.price });

    const completedOrFailed = await waitForEvent(
      this.stream,
      (event) =>
        event.order_id === orderId &&
        (event.type === EventType.OrderCompleted ||
          event.type === EventType.OrderRejected ||
          event.type === EventType.OrderExpired),
      deliveryTimeoutMs,
      `Timed out waiting for ${request.serviceId} to deliver order ${orderId}`,
    );
    if (completedOrFailed.type !== EventType.OrderCompleted) {
      throw new Error(`Order ${orderId} did not complete (status: ${completedOrFailed.type})`);
    }

    const delivery = await this.client.getDelivery(orderId);
    const result = JSON.parse(delivery.deliverableText) as T;
    return { orderId, serviceId: request.serviceId, priceUsdc: order.price, result };
  }
}
