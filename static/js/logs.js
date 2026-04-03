const tableBody = document.querySelector("#logTable tbody");
const filterWrap = document.getElementById("logFilters");
let activeFilter = "all";

const statusChip = (status) => {
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
    const msg = item.details.messages[item.details.messages.length - 1] || "-";
    tr.innerHTML = `
      <td>${new Date(item.timestamp).toLocaleString()}</td>
      <td>${item.request_id}</td>
      <td>${item.source || "mobile"}</td>
      <td>${statusChip(item.final_status)}</td>
      <td>${item.rerouted ? "yes" : "no"}</td>
      <td>${item.network_strength}%</td>
      <td>${item.user_lat}, ${item.user_lng}</td>
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
