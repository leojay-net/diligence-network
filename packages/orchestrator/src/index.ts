import {
  config,
  createCapClient,
  createLogger,
  DeliverableType,
  DiligenceDB,
  DiligenceRequestSchema,
  EventType,
  Hirer,
  type CapEvent,
  type DiligenceRequest,
} from "@diligence-network/core";
import { randomUUID } from "node:crypto";
import { runDiligenceWorkflow } from "./workflow.js";

const logger = createLogger("orchestrator");

async function main(): Promise<void> {
  const db = new DiligenceDB(config.dbPath());
  const serviceId = config.agents.orchestrator.serviceId();

  const client = createCapClient({ sdkKey: config.agents.orchestrator.sdkKey(), serviceId });
  const stream = await client.connectWebSocket();
  const hirer = new Hirer(client, stream, logger);

  // --- Provider side: someone is negotiating to hire us. ---
  stream.on(EventType.NegotiationCreated, async (event: CapEvent) => {
    const negotiationId = event.negotiation_id;
    if (!negotiationId) return;
    try {
      const negotiation = await client.getNegotiation(negotiationId);
      if (negotiation.providerAgentId !== serviceId) return; // not addressed to our service

      DiligenceRequestSchema.parse(JSON.parse(negotiation.requirements));
      const { order } = await client.acceptNegotiation(negotiationId);
      logger.info("buyer negotiation accepted", { negotiationId, orderId: order.orderId });
      db.upsertOrder({
        orderId: order.orderId,
        counterpartyServiceId: order.requesterAgentId,
        direction: "provider",
        serviceDescription: "Verified due-diligence report, produced by hiring and cross-checking independent sub-agents.",
        priceUsdc: order.price,
        status: "created",
        createdAt: order.createdTime,
        updatedAt: order.updatedTime,
        requestPayload: negotiation.requirements,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "invalid request";
      logger.warn("rejecting buyer negotiation", { negotiationId, reason });
      await client.rejectNegotiation(negotiationId, reason).catch(() => undefined);
    }
  });

  // --- A buyer paid us: run the workflow and deliver the report. ---
  stream.on(EventType.OrderPaid, async (event: CapEvent) => {
    const orderId = event.order_id;
    if (!orderId) return;
    const order = await client.getOrder(orderId);
    if (order.providerAgentId !== serviceId) return; // this is one of OUR sub-agent hires, not a buyer order

    db.upsertOrder({
      orderId: order.orderId,
      counterpartyServiceId: order.requesterAgentId,
      direction: "provider",
      serviceDescription: "Verified due-diligence report, produced by hiring and cross-checking independent sub-agents.",
      priceUsdc: order.price,
      status: "paid",
      createdAt: order.createdTime,
      updatedAt: new Date().toISOString(),
      requestPayload: order.negotiationId,
    });

    try {
      const negotiation = await client.getNegotiation(order.negotiationId);
      const request: DiligenceRequest = DiligenceRequestSchema.parse(JSON.parse(negotiation.requirements));

      const { report } = await runDiligenceWorkflow(request, hirer);

      await client.deliverOrder(order.orderId, {
        deliverableType: DeliverableType.Text,
        deliverableText: JSON.stringify(report),
      });
      logger.info("report delivered", { orderId: order.orderId, subject: request.subject });

      db.upsertOrder({
        orderId: order.orderId,
        counterpartyServiceId: order.requesterAgentId,
        direction: "provider",
        serviceDescription: "Verified due-diligence report, produced by hiring and cross-checking independent sub-agents.",
        priceUsdc: order.price,
        status: "completed",
        createdAt: order.createdTime,
        updatedAt: new Date().toISOString(),
        requestPayload: negotiation.requirements,
        resultPayload: report,
      });
      db.saveReport(randomUUID(), request.subject, report);
      for (const entry of report.audit) {
        db.recordAuditEntry(entry, request.subject);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("failed to produce report", { orderId: order.orderId, error: message });
      db.upsertOrder({
        orderId: order.orderId,
        counterpartyServiceId: order.requesterAgentId,
        direction: "provider",
        serviceDescription: "Verified due-diligence report, produced by hiring and cross-checking independent sub-agents.",
        priceUsdc: order.price,
        status: "failed",
        createdAt: order.createdTime,
        updatedAt: new Date().toISOString(),
        requestPayload: order.negotiationId,
        errorMessage: message,
      });
    }
  });

  logger.info("orchestrator listening", { serviceId });

  const shutdown = () => {
    logger.info("shutting down");
    stream.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("fatal error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
