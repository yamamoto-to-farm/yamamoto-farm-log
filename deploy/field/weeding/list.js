import { loadAllWeedingLogs, collectYears } from "./list-utils.js?v=1";

export async function initWeedingList() {
  const items = await loadAllWeedingLogs();
  const years = collectYears(items);

  const container = document.getElementById("weeding-container");
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = '<div class="empty-box">記録がありません。</div>';
    return;
  }

  let html = "";

  years.forEach(year => {
    const list = items.filter(i => i.year === year);

    html += `<div class="year-block">`;
    html += `<h2 class="year-title">${year}年</h2>`;
    html += `<table class="weed-table">`;
    html += `
      <thead>
        <tr>
          <th>日付</th>
          <th>作業</th>
          <th>圃場</th>
          <th>作業者</th>
          <th>農薬</th>
          <th>機械</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
    `;

    list.forEach(r => {
      const machineLabel = [r.mowingMethod, r.machine].map(v => String(v || "").trim()).filter(Boolean).join(" / ") || "-";
      html += `
        <tr>
          <td>${escapeHtml(r.date)}</td>
          <td>${escapeHtml(r.workType)}</td>
          <td>${escapeHtml(r.fieldText)}</td>
          <td>${escapeHtml(r.workers || "-")}</td>
          <td>${escapeHtml(r.pesticides || "-")}</td>
          <td>${escapeHtml(machineLabel)}</td>
          <td>${escapeHtml(r.notes || "")}</td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
  });

  container.innerHTML = html;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
