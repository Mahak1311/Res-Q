const tableBody = document.querySelector("#logTable tbody");
const filterWrap = document.getElementById("logFilters");
let activeFilter = "all";

const statusChip = (status) => {
  if (status === "nearby") return '<span class="chip warn">nearby</span>';
  if (status === "simulation") return '<span class="chip warn">simulation</span>';
  if (status === "connected") return '<span class="chip good">connected</span>';
  if (status === "fallback_sent") return '<span class="chip warn">fallback</span>';
  return '<span class="chip bad">unresolved</span>';
};

function renderRows(rows) {
  tableBody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="7">No log entries for this filter.</td>';
    tableBody.appendChild(tr);
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement("tr");
    const isSimulation = item.kind === "simulation";
    const isNearby = item.kind === "nearby";
    const msg = isSimulation
      ? item.summary || "Simulation event"
      : isNearby
        ? item.summary || "Nearby helper alert"
      : item.details.messages[item.details.messages.length - 1] || "-";
    const requestId = item.request_id;
    const source = isSimulation ? "admin" : isNearby ? "nearby-helpers" : item.source || "mobile";
    const rerouted = isSimulation || isNearby ? "no" : item.rerouted ? "yes" : "no";
    const signal = isSimulation || isNearby ? "--" : `${item.network_strength}%`;
    const location = isSimulation ? (item.target || "global") : isNearby ? (item.target || "nearby") : `${item.user_lat}, ${item.user_lng}`;
    tr.innerHTML = `
      <td>${new Date(item.timestamp).toLocaleString()}</td>
      <td>${requestId}</td>
      <td>${source}</td>
      <td>${statusChip(isSimulation ? "simulation" : isNearby ? "nearby" : item.final_status)}</td>
      <td>${rerouted}</td>
      <td>${signal}</td>
      <td>${location}</td>
      <td>${msg}</td>
    `;
    tableBody.appendChild(tr);
  });
}

async function loadLogs() {
  const response = await fetch(`/api/logs?status=${activeFilter}`);
  const rows = await response.json();
  renderRows(rows);
}

if (filterWrap) {
  filterWrap.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-status]");
    if (!btn) return;

    activeFilter = btn.dataset.status;
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    loadLogs();
  });
}

loadLogs();
setInterval(loadLogs, 5000);
