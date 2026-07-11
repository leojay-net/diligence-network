import { AgentClient, DeliverableType, EventType } from "@croo-network/sdk";
import type {
  AcceptNegotiationResult,
  DeliverOrderRequest,
  DeliverOrderResult,
  Delivery,
  Event,
  ListOptions,
  Negotiation,
  NegotiateOrderRequest,
  Order,
  PayOrderResult,
} from "@croo-network/sdk";
import { config } from "./config.js";
import { registerService } from "./sim/simStore.js";
import { SimAgentClient } from "./sim/simAgentClient.js";

export { DeliverableType, EventType };
export type {
  AcceptNegotiationResult,
  DeliverOrderRequest,
  DeliverOrderResult,
  Delivery,
  ListOptions,
  Negotiation,
  NegotiateOrderRequest,
  Order,
  PayOrderResult,
};

export type CapEvent = Event;

/** The subset of EventStream's public surface every agent actually uses. Both the real EventStream and SimAgentClient's polling stand-in satisfy this. */
export interface CapEventStream {
  on(eventType: string, handler: (event: CapEvent) => void): void;
  onAny(handler: (event: CapEvent) => void): void;
  close(): void;
}

/**
 * The exact public surface of @croo-network/sdk's AgentClient that this
 * network's agents use (uploadFile/getDownloadURL are omitted - every
 * deliverable here is compact enough to inline as JSON text, so no agent
 * needs file storage). SimAgentClient implements the same interface, so
 * agent business logic never branches on CAP_MODE.
 */
export interface CapAgentClient {
  negotiateOrder(req: NegotiateOrderRequest): Promise<Negotiation>;
  acceptNegotiation(negotiationId: string): Promise<AcceptNegotiationResult>;
  acceptNegotiationWithFundAddress(
    negotiationId: string,
    providerFundAddress: string,
  ): Promise<AcceptNegotiationResult>;
  rejectNegotiation(negotiationId: string, reason: string): Promise<void>;
  getNegotiation(negotiationId: string): Promise<Negotiation>;
  listNegotiations(opts?: ListOptions): Promise<Negotiation[]>;
  getOrder(orderId: string): Promise<Order>;
  listOrders(opts?: ListOptions): Promise<Order[]>;
  payOrder(orderId: string): Promise<PayOrderResult>;
  deliverOrder(orderId: string, req: DeliverOrderRequest): Promise<DeliverOrderResult>;
  rejectOrder(orderId: string, reason: string): Promise<void>;
  getDelivery(orderId: string): Promise<Delivery>;
  connectWebSocket(): Promise<CapEventStream>;
}

let simDirectoryRegistered = false;

/** Stands in for CROO Dashboard service registration when CAP_MODE=simulated. */
function ensureSimDirectory(): void {
  if (simDirectoryRegistered) return;
  registerService(config.agents.sourceFinder.serviceId(), {
    providerAgentId: config.agents.sourceFinder.serviceId(),
    priceUsdc: config.agents.sourceFinder.priceUsdc(),
  });
  registerService(config.agents.claimGrader.serviceId(), {
    providerAgentId: config.agents.claimGrader.serviceId(),
    priceUsdc: config.agents.claimGrader.priceUsdc(),
  });
  registerService(config.agents.orchestrator.serviceId(), {
    providerAgentId: config.agents.orchestrator.serviceId(),
    priceUsdc: config.agents.orchestrator.priceUsdc(),
  });
  simDirectoryRegistered = true;
}

export interface CreateCapClientOptions {
  /** SDK key for this agent (live mode) or its identity in the simulated directory (both modes use it as the display name). */
  sdkKey: string;
  /** This agent's own service ID - it acts as that service's provider identity throughout. */
  serviceId: string;
}

export function createCapClient(opts: CreateCapClientOptions): CapAgentClient {
  if (config.capMode() === "live") {
    return new AgentClient({ baseURL: config.croo.apiUrl(), wsURL: config.croo.wsUrl() }, opts.sdkKey);
  }
  ensureSimDirectory();
  return new SimAgentClient(opts.serviceId, config.simDbPath());
}
