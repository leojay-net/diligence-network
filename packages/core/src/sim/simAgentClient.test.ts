import assert from "node:assert/strict";
import { test } from "node:test";
import { unlinkSync } from "node:fs";
import { SimAgentClient } from "./simAgentClient.js";
import { registerService } from "./simStore.js";
import { EventType, DeliverableType } from "@croo-network/sdk";

const TEST_DB = "./data/test-cap-sim.sqlite";

function cleanup(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {
      // fine if it doesn't exist
    }
  }
}

test("full negotiate -> accept -> pay -> deliver -> clear lifecycle", async () => {
  cleanup();
  registerService("test-service", { providerAgentId: "provider-1", priceUsdc: "1.23" });

  const requester = new SimAgentClient("requester-1", TEST_DB);
  const provider = new SimAgentClient("provider-1", TEST_DB);

  const providerStream = await provider.connectWebSocket();
  const requesterStream = await requester.connectWebSocket();

  const accepted = new Promise<void>((resolve) => {
    providerStream.on(EventType.NegotiationCreated, async (event) => {
      assert.ok(event.negotiation_id);
      const { order } = await provider.acceptNegotiation(event.negotiation_id!);
      assert.equal(order.status, "created");
      resolve();
    });
  });

  const delivered = new Promise<void>((resolve) => {
    providerStream.on(EventType.OrderPaid, async (event) => {
      assert.ok(event.order_id);
      const result = await provider.deliverOrder(event.order_id!, {
        deliverableType: DeliverableType.Text,
        deliverableText: JSON.stringify({ ok: true }),
      });
      assert.equal(result.order.status, "completed");
      resolve();
    });
  });

  // The real SDK's Negotiation type carries no orderId - a requester learns
  // the created order's ID from the OrderCreated event, exactly as CAP's own
  // quick-start example does. This asserts that contract, not just that the
  // order eventually clears.
  const orderIdFromEvent = new Promise<string>((resolve) => {
    requesterStream.on(EventType.OrderCreated, (event) => {
      if (event.negotiation_id === negotiation.negotiationId) {
        assert.ok(event.order_id);
        resolve(event.order_id!);
      }
    });
  });

  const completed = new Promise<void>((resolve) => {
    requesterStream.on(EventType.OrderCompleted, () => resolve());
  });

  const negotiation = await requester.negotiateOrder({
    serviceId: "test-service",
    requirements: JSON.stringify({ question: "does this work?" }),
  });
  assert.equal(negotiation.status, "pending");

  await accepted;

  const orderId = await orderIdFromEvent;
  const payResult = await requester.payOrder(orderId);
  assert.equal(payResult.order.status, "paid");

  await delivered;
  await completed;

  const delivery = await requester.getDelivery(orderId);
  assert.deepEqual(JSON.parse(delivery.deliverableText), { ok: true });

  providerStream.close();
  requesterStream.close();
  cleanup();
});

test("delivering an empty result is refused, not silently cleared", async () => {
  cleanup();
  registerService("test-service-2", { providerAgentId: "provider-2", priceUsdc: "0.50" });

  const requester = new SimAgentClient("requester-2", TEST_DB);
  const provider = new SimAgentClient("provider-2", TEST_DB);

  const negotiation = await requester.negotiateOrder({
    serviceId: "test-service-2",
    requirements: JSON.stringify({ question: "x" }),
  });
  const { order } = await provider.acceptNegotiation(negotiation.negotiationId);
  await requester.payOrder(order.orderId);

  await assert.rejects(() =>
    provider.deliverOrder(order.orderId, { deliverableType: DeliverableType.Text, deliverableText: "" }),
  );

  cleanup();
});
