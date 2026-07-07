import { loadAllWeedingLogs, collectYears } from "./list-utils.js?v=1";

const MODES = {
  spray: {
    label: "除草剤散布",
    match: row => row.workType === "除草剤散布",
    note: "除草剤散布のみ表示中"
  },
  mowing: {
    label: "草刈り",
    match: row => row.workType === "草刈り",
    note: "草刈りのみ表示中"
  }
};

const state = {
  items: [],
  mode: "spray"
};

function getModeFromUrl() {
  const params = new URLSearchParams(location.search);
  const mode = String(params.get("mode") || "spray").trim();
  return MODES[mode] ? mode : "spray";
}

function setModeToUrl(mode) {
  const url = new URL(location.href);
  url.searchParams.set("mode", mode);
  history.replaceState({}, "", url.pathname + url.search);
}

function bindModeButtons() {
  const sprayBtn = document.getElementById("mode-spray");
  const mowingBtn = document.getElementById("mode-mowing");

  if (sprayBtn) {
    sprayBtn.onclick = () => {
      if (state.mode === "spray") return;
      state.mode = "spray";
      setModeToUrl(state.mode);
      render();
    };
  }

  if (mowingBtn) {
    mowingBtn.onclick = () => {
      if (state.mode === "mowing") return;
      state.mode = "mowing";
      setModeToUrl(state.mode);
      render();
    };
  }
}

function renderModeUi(filteredCount) {
  const sprayBtn = document.getElementById("mode-spray");
  const mowingBtn = document.getElementById("mode-mowing");
  const note = document.getElementById("mode-note");

  if (sprayBtn) sprayBtn.classList.toggle("active", state.mode === "spray");
  if (mowingBtn) mowingBtn.classList.toggle("active", state.mode === "mowing");

  if (note) {
    note.textContent = `${MODES[state.mode].note}（${filteredCount}件）`;
  }
}

function render() {
  const container = document.getElementById("weeding-container");
  container.innerHTML = "";

  const modeDef = MODES[state.mode];
  const items = state.items.filter(modeDef.match);
  const years = collectYears(items);

  renderModeUi(items.length);

  if (!items.length) {
    container.innerHTML = '<div class="empty-box">記録がありません。</div>';
    return;
  }

  let html = "";

  years.forEach(year => {
    const list = items.filter(i => i.year === year);

    html += `<div class="year-block">`;
    html += `<h2 class="year-title">${year}年</h2>`;
    html += `<div class="list-card">`;
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

    html += `</tbody></table></div></div>`;
  });

  container.innerHTML = html;
}

export async function initWeedingList() {
  state.mode = getModeFromUrl();
  bindModeButtons();
  state.items = await loadAllWeedingLogs();
  render();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
