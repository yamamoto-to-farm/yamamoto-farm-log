// fertilizer/list/list.js

import { loadJSON } from "/common/json.js?v=1";
import { loadAllLogs } from "/common/general-log/base.js?v=1";

/* ============================================================
   初期化
============================================================ */
export async function initFertilizerList() {
  // 肥料マスター
  const index = await loadJSON("/data/fertilizer/fertilizer-index.json");

  // 全圃場 × 全年 × 全ログ
  const logs = await loadAllLogs("fertilizer");

  // 存在する年を抽出
  const years = collectYears(logs);

  const container = document.getElementById("year-container");
  container.innerHTML = "";

  years.forEach(year => {
    const table = createYearTable(year, index, logs);
    container.appendChild(table);
  });
}

/* ============================================================
   ログから存在する年を抽出
============================================================ */
function collectYears(logs) {
  const set = new Set();

  logs.forEach(f => {
    set.add(f.year);   // ← ★ loadAllLogs の構造に合わせる
  });

  return Array.from(set).sort((a, b) => b - a);
}

/* ============================================================
   年ごとのテーブル生成
============================================================ */
function createYearTable(year, index, logs) {
  const wrapper = document.createElement("div");
  wrapper.className = "year-block";

  const header = document.createElement("h2");
  header.className = "year-title";
  header.textContent = `${year}年`;
  header.onclick = () => wrapper.classList.toggle("open");

  const table = document.createElement("table");
  table.className = "fert-table";

  // ヘッダ行
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>肥料名</th>
      ${[...Array(12)].map((_, i) => `<th>${i + 1}月</th>`).join("")}
      <th>合計</th>
    </tr>
  `;
  table.appendChild(thead);

  // 本体
  const tbody = document.createElement("tbody");

  index.forEach(fert => {
    const row = document.createElement("tr");

    // 肥料名（クリックで詳細へ）
    const nameCell = document.createElement("td");
    nameCell.innerHTML = `
      <a href="./month.html?year=${year}&fertilizer=${encodeURIComponent(fert.name)}">
        ${fert.name}
      </a>`;
    row.appendChild(nameCell);

    // 月別集計
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      const amount = sumFertilizer(logs, fert.name, year, m);
      total += amount;

      const td = document.createElement("td");
      td.textContent = amount ? amount : "";
      row.appendChild(td);
    }

    // 合計
    const totalCell = document.createElement("td");
    totalCell.textContent = total ? total : "";
    row.appendChild(totalCell);

    tbody.appendChild(row);
  });

  table.appendChild(tbody);

  wrapper.appendChild(header);
  wrapper.appendChild(table);

  return wrapper;
}

/* ============================================================
   指定肥料 × 年 × 月 の施肥量合計
============================================================ */
function sumFertilizer(logs, fertName, year, month) {
  let sum = 0;

  logs.forEach(field => {
    // ★ 年が一致するログだけを見る
    if (field.year != year) return;

    field.entries.forEach(e => {
      if (!e.fertilizers) return;

      const m = Number(e.date.slice(5, 7));
      if (m !== month) return;

      e.fertilizers.forEach(f => {
        if (f.name === fertName) {
          sum += Number(f.amount || 0);
        }
      });
    });
  });

  return sum;
}
