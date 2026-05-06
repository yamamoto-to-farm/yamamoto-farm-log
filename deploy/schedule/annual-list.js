// annual-list.js（年フィルタ + 権限対応）

import { loadJSON } from "/common/json.js";

const loadBtn = document.getElementById("loadAnnual");
const tableArea = document.getElementById("table-area");
const yearSelector = document.getElementById("yearSelector");

let annualAll = null;

/* ============================================================
   annual.json 読み込み
============================================================ */
loadBtn.addEventListener("click", async () => {
  try {
    annualAll = await loadJSON("/logs/schedule/annual/annual.json");

    // 年フィルタ生成
    const years = Object.keys(annualAll).sort();
    yearSelector.innerHTML = years
      .map(y => `<option value="${y}">${y}年</option>`)
      .join("");

    renderSelectedYear();
  } catch (e) {
    tableArea.innerHTML = `<p>annual.json の読み込みに失敗しました</p>`;
    console.error(e);
  }
});

/* ============================================================
   年選択時
============================================================ */
yearSelector.addEventListener("change", () => {
  renderSelectedYear();
});

/* ============================================================
   選択された年だけ表示
============================================================ */
function renderSelectedYear() {
  if (!annualAll) return;

  const y = yearSelector.value;
  const data = annualAll[y];

  if (!data) {
    tableArea.innerHTML = "<p>データがありません</p>";
    return;
  }

  // ★ ロール判定（admin のみ編集可能）
  const isAdmin = window.currentRole === "admin";

  tableArea.innerHTML = `
    <div class="card">
      <h2>${y} 年の作付計画</h2>

      ${
        isAdmin
          ? `<a href="/schedule/annual/index.html?year=${y}" class="primary-btn">編集する</a>`
          : `<span style="opacity:0.6;">閲覧のみ（編集不可）</span>`
      }
    </div>
  `;
}
