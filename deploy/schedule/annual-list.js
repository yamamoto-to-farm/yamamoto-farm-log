// annual-list.js
import { loadFilterUI, getActiveFilters } from "/common/filter.js";

export function initAnnualListPage() {
  setupYearFilter();
}

function setupYearFilter() {
  loadFilterUI({
    types: ["year"],
    onChange: handleYearChange
  });
}

async function handleYearChange() {
  const filters = getActiveFilters();
  const year = filters.year;

  if (!year) {
    document.getElementById("summary-card").style.display = "none";
    return;
  }

  const filePath = `/logs/schedule/annual/${year}/${year}-作付計画.json`;

  try {
    const res = await fetch(filePath);
    if (!res.ok) {
      showNoData(year);
      return;
    }

    const data = await res.json();
    showSummary(year, data);

  } catch (e) {
    console.error(e);
    showNoData(year);
  }
}

function showNoData(year) {
  const card = document.getElementById("summary-card");
  card.style.display = "block";

  document.getElementById("summary-title").textContent = `${year}年の作付計画はありません`;
  document.getElementById("summary-content").innerHTML = `
    <p>この年の作付計画ファイル（${year}-作付計画.json）は存在しません。</p>
  `;

  document.getElementById("editLink").href = `/schedule/annual/index.html?year=${year}`;
  document.getElementById("planLink").href = `/schedule/plan.html?year=${year}`;
}

function showSummary(year, data) {
  const card = document.getElementById("summary-card");
  card.style.display = "block";

  document.getElementById("summary-title").textContent = `${year}年 作付計画`;

  const step1 = data.step1 || {};
  const step2 = data.step2 || [];

  const totalArea = step1.totalArea ?? "-";
  const lotCount = step2.length;

  document.getElementById("summary-content").innerHTML = `
    <p><strong>必要反数：</strong> ${totalArea}</p>
    <p><strong>週別ロット数：</strong> ${lotCount} ロット</p>
  `;

  document.getElementById("editLink").href = `/schedule/annual/index.html?year=${year}`;
  document.getElementById("planLink").href = `/schedule/plan.html?year=${year}`;
}
