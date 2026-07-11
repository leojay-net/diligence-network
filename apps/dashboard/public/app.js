const REFRESH_MS = 3000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function durationLabel(startedAt, completedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const seconds = (end - start) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${(seconds / 60).toFixed(1)}m`;
}

function shortId(id) {
  if (!id) return "—";
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function verdictCounts(payload) {
  const verdicts = payload?.verdicts ?? [];
  return {
    supported: verdicts.filter((v) => v.verdict === "supported").length,
    contradicted: verdicts.filter((v) => v.verdict === "contradicted").length,
    unverifiable: verdicts.filter((v) => v.verdict === "unverifiable").length,
  };
}

async function renderReports() {
  const reports = await fetchJson("/api/reports");
  const body = document.getElementById("reports-body");
  document.getElementById("reports-count").textContent = `${reports.length} total`;

  if (reports.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">No reports delivered yet.</td></tr>`;
    return;
  }

  body.innerHTML = reports
    .map((report) => {
      const counts = verdictCounts(report.payload);
      const confidence = report.payload?.confidenceScore;
      return `<tr class="row-clickable" data-report-id="${escapeHtml(report.id)}">
        <td>${escapeHtml(report.subject)}</td>
        <td>${typeof confidence === "number" ? confidence.toFixed(2) : "—"}</td>
        <td>${counts.supported}</td>
        <td>${counts.contradicted}</td>
        <td>${counts.unverifiable}</td>
        <td>${formatTime(report.createdAt)}</td>
      </tr>`;
    })
    .join("");

  for (const row of body.querySelectorAll("tr[data-report-id]")) {
    row.addEventListener("click", () => showReportDetail(row.dataset.reportId));
  }
}

async function showReportDetail(reportId) {
  const report = await fetchJson(`/api/reports/${reportId}`);
  const payload = report.payload;
  const detail = document.getElementById("report-detail");

  const findingsHtml = (payload.findings ?? [])
    .map(
      (f) => `<div class="finding">
        <div class="finding-claim">${escapeHtml(f.claim)}</div>
        ${(f.citations ?? [])
          .map((c) => `<div class="finding-citation">${escapeHtml(c.title)} — ${escapeHtml(c.url)}</div>`)
          .join("")}
      </div>`,
    )
    .join("") || "<p>No findings.</p>";

  const verdictsHtml = (payload.verdicts ?? [])
    .map(
      (v) => `<div class="finding">
        <div class="finding-claim">[${escapeHtml(v.verdict).toUpperCase()}] ${escapeHtml(v.claim)}</div>
        <div class="finding-citation">${escapeHtml(v.rationale)}</div>
      </div>`,
    )
    .join("") || "<p>No verdicts.</p>";

  const auditHtml = (payload.audit ?? [])
    .map(
      (a) =>
        `<div class="finding-citation">${escapeHtml(a.agentRole)} · ${escapeHtml(a.serviceId)} · order ${shortId(a.orderId)} · ${escapeHtml(a.costUsdc)} USDC · ${escapeHtml(a.status)} · ${durationLabel(a.startedAt, a.completedAt)}</div>`,
    )
    .join("") || "<p>No audit entries.</p>";

  detail.innerHTML = `
    <button class="close-detail" id="close-detail">Close</button>
    <h3>${escapeHtml(payload.subject)}</h3>
    <div class="detail-section">
      <h4>Summary</h4>
      <pre>${escapeHtml(payload.summary ?? "")}</pre>
    </div>
    <div class="detail-section">
      <h4>Findings (${(payload.findings ?? []).length})</h4>
      ${findingsHtml}
    </div>
    <div class="detail-section">
      <h4>Verdicts (${(payload.verdicts ?? []).length})</h4>
      ${verdictsHtml}
    </div>
    <div class="detail-section">
      <h4>Audit trail</h4>
      ${auditHtml}
    </div>
  `;
  detail.hidden = false;
  document.getElementById("close-detail").addEventListener("click", () => {
    detail.hidden = true;
  });
}

async function renderOrders() {
  const orders = await fetchJson("/api/orders");
  const body = document.getElementById("orders-body");
  document.getElementById("orders-count").textContent = `${orders.length} total`;

  if (orders.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">No orders yet.</td></tr>`;
    return;
  }

  body.innerHTML = orders
    .map(
      (o) => `<tr>
        <td class="mono">${escapeHtml(shortId(o.orderId))}</td>
        <td>${escapeHtml(o.direction)}</td>
        <td class="mono">${escapeHtml(o.counterpartyServiceId)}</td>
        <td>${escapeHtml(o.serviceDescription)}</td>
        <td>${escapeHtml(o.priceUsdc)}</td>
        <td class="status">${escapeHtml(o.status).toUpperCase()}</td>
        <td>${formatTime(o.updatedAt)}</td>
      </tr>`,
    )
    .join("");
}

async function renderAudit() {
  const entries = await fetchJson("/api/audit");
  const body = document.getElementById("audit-body");
  document.getElementById("audit-count").textContent = `${entries.length} total`;

  if (entries.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">No sub-agent hires yet.</td></tr>`;
    return;
  }

  body.innerHTML = entries
    .map(
      (a) => `<tr>
        <td>${escapeHtml(a.reportSubject)}</td>
        <td class="mono">${escapeHtml(a.subtaskId)}</td>
        <td>${escapeHtml(a.agentRole)}</td>
        <td class="mono">${escapeHtml(a.serviceId)}</td>
        <td class="mono">${escapeHtml(shortId(a.orderId))}</td>
        <td>${escapeHtml(a.costUsdc)}</td>
        <td class="status">${escapeHtml(a.status).toUpperCase()}</td>
        <td>${durationLabel(a.startedAt, a.completedAt)}</td>
      </tr>`,
    )
    .join("");
}

async function refreshAll() {
  try {
    await Promise.all([renderReports(), renderOrders(), renderAudit()]);
  } catch (err) {
    console.error("dashboard refresh failed", err);
  }
}

refreshAll();
setInterval(refreshAll, REFRESH_MS);
