// annual.js（年間作付計画 編集ページ）

import { getFilter, setFilterData } from "/common/filter/filter-core.js";
import { openFieldModal } from "/common/filter/filter-field.js";
import { openVarietyModal } from "/common/filter/filter-variety.js";
import { loadJSON, saveJSON } from "/common/json.js";

/* ============================================================
   初期化
============================================================ */
window.addEventListener("DOMContentLoaded", async () => {

  const year = new URLSearchParams(location.search).get("year");
  document.getElementById("pageTitle").textContent = `${year} 年間作付計画`;

  /* ------------------------------------------------------------
     ▼ 年間作付計画ファイル読み込み（404 → 新規作成）
     ------------------------------------------------------------ */
  let annual;

  try {
    annual = await loadJSON(`/logs/schedule/annual/${year}-作付計画.json`);
  } catch (e) {
    console.warn("作付計画ファイルが存在しません → 新規作成モード");
    annual = { year, rows: [] };
  }

  /* ------------------------------------------------------------
     ▼ 圃場データ
     ------------------------------------------------------------ */
  const fields = await loadJSON("/data/fields.json");
  const areaMap = {};
  const areaOrder = [];

  fields.forEach(f => {
    if (!areaMap[f.area]) {
      areaMap[f.area] = [];
      areaOrder.push(f.area);
    }
    areaMap[f.area].push(f.name);
  });

  /* ------------------------------------------------------------
     ▼ 品種データ
     ------------------------------------------------------------ */
  const varieties = await loadJSON("/data/varieties.json");
  const typeMap = {};
  const typeOrder = [];

  varieties.forEach(v => {
    if (!typeMap[v.type]) {
      typeMap[v.type] = [];
      typeOrder.push(v.type);
    }
    typeMap[v.type].push(v.name);
  });

  /* ------------------------------------------------------------
     ▼ フィルタデータセット
     ------------------------------------------------------------ */
  setFilterData({
    years: [year],
    months: {},
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  });

  /* ------------------------------------------------------------
     ▼ フィルタボタン
     ------------------------------------------------------------ */
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  /* ------------------------------------------------------------
     ▼ フィルタイベント
     ------------------------------------------------------------ */
  window.addEventListener("filter:apply", (e) => {
    renderTable(annual, e.detail);
  });

  window.addEventListener("filter:reset", () => {
    renderTable(annual, getFilter());
  });

  /* ------------------------------------------------------------
     ▼ 行追加
     ------------------------------------------------------------ */
  document.getElementById("addRow").addEventListener("click", () => {
    annual.rows.push({
      variety: "",
      field: "",
      area: "",
      sowing: "",
      planting: "",
      harvestMonth: "",
      memo: ""
    });
    renderTable(annual, getFilter());
  });

  /* ------------------------------------------------------------
     ▼ 保存
     ------------------------------------------------------------ */
  document.getElementById("save").addEventListener("click", async () => {

    await saveJSON(`/logs/schedule/annual/${year}-作付計画.json`, annual);
    await updateYearIndex(year);

    alert("保存しました");
  });

  /* ------------------------------------------------------------
     ▼ 初期表示
     ------------------------------------------------------------ */
  renderTable(annual, getFilter());
});

/* ============================================================
   year-index.json を自動更新
============================================================ */
async function updateYearIndex(year) {
  let index;

  try {
    index = await loadJSON("/logs/schedule/annual/year-index.json");
  } catch {
    index = { years: [] };
  }

  if (!index.years.includes(year)) {
    index.years.push(year);
    index.years.sort();
  }

  await saveJSON("/logs/schedule/annual/year-index.json", index);
}

/* ============================================================
   テーブル描画
============================================================ */
function renderTable(annual, state) {

  const rows = annual.rows.filter(r => {

    if (state.fields.length && !state.fields.includes(r.field)) return false;
    if (state.varieties.length && !state.varieties.includes(r.variety)) return false;

    return true;
  });

  let html = `
    <table>
      <thead>
        <tr>
          <th>品種</th>
          <th>圃場</th>
          <th>面積</th>
          <th>播種日</th>
          <th>定植日</th>
          <th>収穫月</th>
          <th>メモ</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach((r, i) => {
    html += `
      <tr>
        <td><input value="${r.variety}" data-i="${i}" data-k="variety"></td>
        <td><input value="${r.field}" data-i="${i}" data-k="field"></td>
        <td><input value="${r.area}" data-i="${i}" data-k="area"></td>
        <td><input type="date" value="${r.sowing}" data-i="${i}" data-k="sowing"></td>
        <td><input type="date" value="${r.planting}" data-i="${i}" data-k="planting"></td>
        <td><input value="${r.harvestMonth}" data-i="${i}" data-k="harvestMonth"></td>
        <td><input value="${r.memo}" data-i="${i}" data-k="memo"></td>
        <td><span class="delete-btn" data-del="${i}">削除</span></td>
      </tr>
    `;
  });

  html += `</tbody></table>`;

  document.getElementById("table-area").innerHTML = html;

  document.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = inp.dataset.i;
      const k = inp.dataset.k;
      annual.rows[i][k] = inp.value;
    });
  });

  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = btn.dataset.del;
      annual.rows.splice(i, 1);
      renderTable(annual, state);
    });
  });
}
