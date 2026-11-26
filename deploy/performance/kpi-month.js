import { loadJSON } from "/common/json.js?v=1.1";
import { loadCSV } from "/common/csv.js?v=1.1";
import { safeFileName } from "/common/utils.js?v=1.1";
import { calcAreaTanFromSummaryPlanting } from "./kpi-utils.js?v=20261001-1";
import { analyzeSales, groupDailyEntries, validateLotRefs } from "/sales/sales-logic.js?v=20261125-1";
import { salesApi, openSettlementPdf } from "/sales/sales-api.js?v=20261125-1";
import { hasSession, login } from "/photos/auth.js?v=20261029-2";

const startDate = "2026-11-01";
const el = id => document.getElementById(id);
const format = value => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
let reports = null;
let weights = [];
let index = null;
let salesMessage = "";

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function initialPeriod() {
  const params = new URLSearchParams(location.search);
  if (params.has("from") && params.has("to")) return [params.get("from"), params.get("to")];
  const year = Number(params.get("year")), month = Number(params.get("month"));
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("表示する年・月が不正です。");
  }
  const ym = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return [`${ym}-01`, `${ym}-${new Date(year, month, 0).getDate()}`];
}

async function loadSummaryByRef(ref) {
  for (const field in index) {
    for (const year in index[field]) {
      for (const file of index[field][year]) {
        if (safeFileName(file.replace(".json", "")) === ref) {
          return loadJSON(`/logs/summary/${field}/${year}/${file}`);
        }
      }
    }
  }
  return null;
}

function td(row, value) {
  const cell = document.createElement("td");
  if (value instanceof Node) cell.append(value);
  else cell.textContent = value;
  row.append(cell);
  return cell;
}

function link(text, path) {
  const anchor = document.createElement("a");
  anchor.textContent = text;
  anchor.href = path;
  return anchor;
}

function salesText(rows) {
  const matched = rows.filter(row => row.amount !== null);
  if (!matched.length) return rows.some(row => row.matchStatus !== "対象外") ? "未確定" : "対象外";
  const amount = matched.reduce((sum, row) => sum + row.amount, 0);
  return `${format(amount)}円${matched.length !== rows.length ? "（一部未確定）" : ""}`;
}

function detailTable(entries) {
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const name of ["出荷日", "出荷重量", "出荷基数", "単価", "売上概算", "照合状況", "通知書"]) {
    const th = document.createElement("th");
    th.textContent = name;
    head.append(th);
  }
  const body = table.createTBody();
  for (const entry of entries.sort((a, b) => a.shippingDate.localeCompare(b.shippingDate))) {
    const row = body.insertRow();
    td(row, entry.shippingDate);
    td(row, entry.weight === null || !Number.isFinite(entry.weight) ? "未記録" : `${format(entry.weight)}kg`);
    td(row, entry.bins === null || !Number.isFinite(entry.bins) ? "未記録" : `${format(entry.bins)}基`);
    td(row, entry.unitPrice === null ? "—" : `${format(entry.unitPrice)}円/kg`);
    td(row, entry.amount === null ? "未確定" : `${format(entry.amount)}円`);
    td(row, entry.matchReason ? `${entry.matchStatus}：${entry.matchReason}` : entry.matchStatus);
    if (entry.reportDate) {
      const wrapper = document.createElement("div");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${entry.reportDate} / ${entry.reportNumber}（PDF）`;
      button.addEventListener("click", () => openSettlementPdf(entry.reportDate, entry.reportNumber)
        .catch(error => { console.error("[kpi] PDF", error); el("sales-status").textContent = error.message; }));
      wrapper.append(button, document.createTextNode(` 伝票全体：${format(entry.reportAmount)}円`));
      td(row, wrapper);
    } else if (entry.shippingDate >= startDate) {
      const query = new URLSearchParams({ from: entry.shippingDate, to: entry.shippingDate });
      td(row, link("売上明細を確認", `/sales/index.html?${query}`));
    } else td(row, "対象外");
  }
  return table;
}

async function renderPeriod() {
  const from = el("period-from").value, to = el("period-to").value;
  if (!validDate(from) || !validDate(to) || from > to) throw new Error("出荷日の期間を正しく指定してください。");
  el("sales-status").textContent = salesMessage;
  el("month-title").textContent = `${from}〜${to} ロット別収穫・出荷`;
  const filtered = weights.filter(row => row.shippingDate >= from && row.shippingDate <= to);
  const lots = new Map();
  let missingRefs = 0;
  for (const row of filtered) {
    const ref = safeFileName(row.plantingRef || "");
    if (!ref) { missingRefs++; continue; }
    if (!lots.has(ref)) lots.set(ref, { kg: 0, units: 0, dates: [] });
    const lot = lots.get(ref);
    lot.kg += Number(row.totalWeight || 0);
    lot.units += Number(row.bins || 0);
    lot.dates.push(row.shippingDate);
  }

  let daily = [];
  let salesError = "";
  if (reports && to >= startDate) {
    try {
      daily = analyzeSales(reports, weights, from < startDate ? startDate : from, to).daily;
      validateLotRefs(daily, safeFileName);
    }
    catch (error) {
      console.error("[kpi] sales reconciliation failed", error);
      daily = [];
      salesError = error.message;
    }
  }
  if (salesError) el("sales-status").textContent = `売上照合に失敗しました：${salesError}`;
  const tbody = el("kpi-month-body");
  tbody.replaceChildren();
  let totalArea = 0, totalKg = 0, totalUnits = 0;
  let missingSummaries = 0;
  const allEntries = [];
  for (const [ref, lot] of lots) {
    const summary = await loadSummaryByRef(ref);
    if (!summary) {
      console.warn("[kpi] summary not found", ref);
      missingSummaries++;
      continue;
    }
    const planting = summary.planting;
    const area = calcAreaTanFromSummaryPlanting(planting);
    totalArea += area;
    totalKg += lot.kg;
    totalUnits += lot.units;
    const entries = filtered.filter(row => safeFileName(row.plantingRef) === ref).map(row => {
      const value = Number(row.totalWeight);
      const weight = String(row.totalWeight || "").trim() && Number.isFinite(value) && value > 0 ? value : null;
      const binValue = Number(row.bins);
      const bins = String(row.bins ?? "").trim() && Number.isFinite(binValue) && binValue >= 0 ? binValue : null;
      if (row.shippingDate < startDate) return { shippingDate: row.shippingDate, weight, bins, amount: null, unitPrice: null, matchStatus: "対象外", matchReason: "2026年11月より前" };
      if (!reports || salesError) return { shippingDate: row.shippingDate, weight, bins, amount: null, unitPrice: null, matchStatus: "未取得", matchReason: "売上情報を確認できません" };
      return null;
    }).filter(Boolean);
    entries.push(...daily.filter(row => safeFileName(row.plantingRef) === ref));
    const grouped = groupDailyEntries(entries);
    allEntries.push(...entries);
    const row = document.createElement("tr");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = `▶ ${ref}`;
    button.setAttribute("aria-expanded", "false");
    td(row, button);
    td(row, link(planting.variety || "-", `/varieties/index.html?variety=${encodeURIComponent(planting.variety || "")}`));
    td(row, link(planting.field || "-", `/fields/index.html?field=${encodeURIComponent(planting.field || "")}`));
    td(row, area.toFixed(2));
    td(row, format(lot.kg));
    td(row, format(lot.units));
    lot.dates.sort();
    td(row, lot.dates[0] === lot.dates.at(-1) ? lot.dates[0] : `${lot.dates[0]}〜${lot.dates.at(-1)}`);
    td(row, salesText(entries));
    const detail = document.createElement("tr");
    detail.hidden = true;
    detail.className = "sales-detail";
    const detailCell = td(detail, detailTable(grouped));
    detailCell.colSpan = 8;
    button.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      button.setAttribute("aria-expanded", String(!detail.hidden));
      button.textContent = `${detail.hidden ? "▶" : "▼"} ${ref}`;
    });
    tbody.append(row, detail);
  }
  const total = el("kpi-month-total");
  total.replaceChildren();
  for (const value of ["合計", "", "", totalArea.toFixed(2), format(totalKg), format(totalUnits), "—",
    allEntries.length ? salesText(allEntries) : "—"]) td(total, value);
  if (missingSummaries) {
    el("sales-status").textContent += ` 集計元の作付け情報がないロットが${missingSummaries}件あり、表から除外しました。`;
  }
  if (missingRefs) el("sales-status").textContent += ` 作付け未記録の出荷が${missingRefs}件あり、表から除外しました。`;
}

async function init() {
  try {
    const [from, to] = initialPeriod();
    el("period-from").value = from;
    el("period-to").value = to;
    [weights, index] = await Promise.all([loadCSV("/logs/weight/all.csv"), loadJSON("/data/summary-index.json")]);
    el("sales-login").hidden = hasSession();
    el("sales-login").onclick = () => login(location.pathname + location.search + location.hash)
      .catch(error => { console.error("[kpi] login failed", error); el("sales-status").textContent = error.message; });
    if (hasSession()) {
      try {
        const data = await salesApi("/analyses");
        if (!Array.isArray(data.reports)) throw new Error("売上データの形式が不正です。");
        reports = data.reports;
        salesMessage = "売上情報を取得しました。";
      } catch (error) {
        console.error("[kpi] sales load failed", error);
        salesMessage = `売上情報を取得できません：${error.message}`;
        el("sales-login").hidden = hasSession();
      }
    } else {
      salesMessage = "売上概算はCognitoにログインすると表示します。";
    }
    el("apply-period").addEventListener("click", async () => {
      el("apply-period").disabled = true;
      try {
        await renderPeriod();
        const params = new URLSearchParams({ from: el("period-from").value, to: el("period-to").value });
        history.replaceState(null, "", `${location.pathname}?${params}`);
      } catch (error) {
        console.error("[kpi] period failed", error);
        el("sales-status").textContent = error.message;
      } finally {
        el("apply-period").disabled = false;
      }
    });
    await renderPeriod();
  } catch (error) {
    console.error("[kpi] load failed", error);
    el("month-title").textContent = "データを表示できません";
    el("sales-status").textContent = error.message;
  }
}

init();
