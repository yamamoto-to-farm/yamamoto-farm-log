// kpi-month.js（CloudFront 対応・完全版）

import { loadJSON } from "/common/json.js?v=1.1";
import { loadCSV } from "/common/csv.js?v=1.1";
import { safeFileName } from "/common/utils.js?v=1.1";

const DEBUG = false;
const log = (...a) => DEBUG && console.log("[KPI-MONTH]", ...a);

/* ===============================
   URL パラメータ取得
=============================== */
function getParams() {
  const params = new URLSearchParams(location.search);
  return {
    year: Number(params.get("year")),
    month: Number(params.get("month"))
  };
}

/* ===============================
   plantingRef → summary を読み込む
=============================== */
async function loadSummaryByRef(plantingRef) {
  const index = await loadJSON("/data/summary-index.json");

  for (const field in index) {
    for (const year in index[field]) {
      for (const file of index[field][year]) {
        const ref = safeFileName(file.replace(".json", ""));
        if (ref === plantingRef) {
          return await loadJSON(`/logs/summary/${field}/${year}/${file}`);
        }
      }
    }
  }
  return null;
}

/* ===============================
   面積（反）
=============================== */
function calcAreaTan(planting) {
  const qty = Number(planting.quantity || 0);
  const row = Number(planting.spacing.row || 0);
  const bed = Number(planting.spacing.bed || 0);
  return (qty * row * bed) / 10000000;
}

/* ===============================
   メイン処理
=============================== */
async function renderMonthPage() {
  const { year, month } = getParams();
  log("対象:", year, month);

  // タイトル更新
  document.getElementById("month-title").textContent = `${year}年${month}月`;

  // CSV 読み込み（CloudFront 絶対パス）
  const weightRows = await loadCSV("/logs/weight/all.csv");

  // shippingDate で該当月を抽出
  const filtered = weightRows.filter(row => {
    const d = new Date(row.shippingDate);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });

  log("該当月の出荷行:", filtered);

  // plantingRef ごとに集計
  const map = {};

  filtered.forEach(row => {
    const ref = safeFileName(row.plantingRef);
    if (!ref) return;

    if (!map[ref]) {
      map[ref] = {
        kg: 0,
        units: 0,
        dates: [],
      };
    }

    map[ref].kg += Number(row.totalWeight || 0);
    map[ref].units += Number(row.bins || 0);
    map[ref].dates.push(row.shippingDate);
  });

  log("ロット集計:", map);

  const tbody = document.getElementById("kpi-month-body");

  let totalArea = 0;
  let totalKg = 0;
  let totalUnits = 0;

  // plantingRef ごとに summary を読み込みつつ行を作る
  for (const ref of Object.keys(map)) {
    const summary = await loadSummaryByRef(ref);

    if (!summary) continue;

    const planting = summary.planting;

    const variety = planting.variety || "-";
    const field = planting.field || "-";

    const area = calcAreaTan(planting);
    const kg = map[ref].kg;
    const units = map[ref].units;

    const ratio = area > 0 ? (kg / area).toFixed(1) : "-";

    // 収穫期間
    const dates = map[ref].dates.map(d => new Date(d)).sort((a, b) => a - b);
    const start = dates.length ? dates[0].toISOString().slice(0, 10) : "-";
    const end = dates.length ? dates[dates.length - 1].toISOString().slice(0, 10) : "-";
    const period = start === end ? start : `${start}〜${end}`;

    // 合計用
    totalArea += area;
    totalKg += kg;
    totalUnits += units;

    // 行追加（★ analysis も絶対パスに修正）
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td class="left">${ref}</td>
        <td class="left">${variety}</td>
        <td class="left">${field}</td>
        <td>${area.toFixed(2)}</td>
        <td>${kg.toLocaleString()}</td>
        <td>${units.toLocaleString()}</td>
        <td>${ratio}</td>
        <td class="left">${period}</td>
        <td class="left">
          <a href="/analysis/index.html?field=${encodeURIComponent(field)}">
            分析
          </a>
        </td>
      </tr>
    `);
  }

  // 合計行
  document.getElementById("kpi-month-total").innerHTML = `
    <td class="left">合計</td>
    <td></td>
    <td></td>
    <td>${totalArea.toFixed(2)}</td>
    <td>${totalKg.toLocaleString()}</td>
    <td>${totalUnits.toLocaleString()}</td>
    <td>${totalArea > 0 ? (totalKg / totalArea).toFixed(1) : "-"}</td>
    <td class="left">-</td>
    <td></td>
  `;
}

renderMonthPage();