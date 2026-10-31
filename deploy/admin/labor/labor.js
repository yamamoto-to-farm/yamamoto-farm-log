// 労務費ダッシュボード
// 各月の最新 plan.json＋編集データから人件費（交通費込み）を集計して、月別推移と人別内訳を表示する。
// 月末にTimeTreeを確定して再取得した月は、ほぼ実績値になる（真の実績はKingOfTime。将来連携予定）。
import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { config } from "/photos/config.js";
import { ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import {
  applyAdjustments, computeCost, defaultScenarioIndex, fitRemaining, formatYen, personColorMap,
} from "/admin/shift/shift-logic.js?v=20261030-36";

const element = (id) => document.getElementById(id);
let rows = [];  // [{month, cost:{total, perPerson}, budgetMax, generatedAt, staff}]

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

async function api(path, query) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインの期限が切れました。再ログインしてください。");
  const url = `${config.api}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const response = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let message = `エラー（${response.status}）`;
    try { message = `${(await response.json()).message}（${response.status}）`; } catch { /* 本文なし */ }
    throw new Error(message);
  }
  return response.json();
}

// 1か月分：plan＋editsから実効アイテムを組み立てて集計（シフトページと同じロジック）
async function loadMonth(month) {
  const plan = await api("/shift/plan", { month });
  const edits = { overrides: {}, base: null, autofit: false };
  try {
    const result = await api("/shift/edits", { month });
    Object.assign(edits, result.data || {});
  } catch { /* 編集なし（404）は正常 */ }
  const scenario = plan.scenarios[defaultScenarioIndex(plan)];
  let eff = applyAdjustments(plan, scenario, edits.overrides || {}, edits.base || null);
  if (edits.autofit) eff = fitRemaining(plan, eff, scenario.budget_max, edits.base || null).items;
  return {
    month,
    cost: computeCost(eff, plan),
    budgetMax: plan.targets.labor_budget_yen?.max ?? null,
    generatedAt: plan.generated_at || "",
    staff: plan.staff || [],
  };
}

function monthLabel(month) {
  return `${Number(month.slice(5))}月`;
}

function allNames() {
  const names = [];
  for (const row of rows) {
    for (const name of Object.keys(row.cost.perPerson)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

function colorMap() {
  // 全月のスタッフをまとめて色割り当て（timetree準拠色）
  const merged = [];
  const seen = new Set();
  for (const row of rows) {
    for (const member of row.staff) {
      if (!seen.has(member.name)) { seen.add(member.name); merged.push(member); }
    }
  }
  for (const name of allNames()) {
    if (!seen.has(name)) { seen.add(name); merged.push({ name }); }
  }
  return personColorMap(merged);
}

function render() {
  const colors = colorMap();
  const asc = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const latest = asc[asc.length - 1];

  // サマリー
  const over = latest.budgetMax != null && latest.cost.total > latest.budgetMax;
  const totalAll = asc.reduce((sum, row) => sum + row.cost.total, 0);
  element("summary").innerHTML = [
    [`${monthLabel(latest.month)}`, "最新の月", ""],
    [formatYen(latest.cost.total), "最新月の人件費（概算）", over ? "over" : ""],
    [latest.budgetMax != null ? formatYen(latest.budgetMax) : "-", "月の予算上限", ""],
    [formatYen(Math.round(totalAll / asc.length)), `月平均（${asc.length}か月）`, ""],
  ].map(([value, label, cls]) =>
    `<div class="stat ${cls}"><b>${value}</b><span>${label}</span></div>`).join("");

  // 月別チャート（人別の積み上げ・予算上限は破線）
  const peak = Math.max(...asc.map((row) => Math.max(row.cost.total, row.budgetMax || 0)), 1);
  element("chart").innerHTML = asc.map((row) => {
    const segs = Object.entries(row.cost.perPerson)
      .sort((a, b) => a[0].localeCompare(b[0], "ja"))
      .map(([name, p]) => {
        const h = Math.round((p.cost / peak) * 170);
        return `<div class="seg" style="height:${h}px;background:${colors.get(name) || "#90a4ae"}"
                     title="${name}: ${formatYen(p.cost)}（${p.days}日・${p.hours}h）"></div>`;
      }).join("");
    const budgetY = row.budgetMax != null ? Math.round((row.budgetMax / peak) * 170) : null;
    const isOver = row.budgetMax != null && row.cost.total > row.budgetMax;
    return `
      <div class="labor-col">
        <span class="amount${isOver ? " over" : ""}">${Math.round(row.cost.total / 1000).toLocaleString()}千円</span>
        <div class="bar-wrap">
          ${segs}
          ${budgetY != null ? `<div class="budget-mark" style="bottom:${budgetY}px" title="予算上限 ${formatYen(row.budgetMax)}"></div>` : ""}
        </div>
        <a href="/admin/shift/index.html" class="label" title="${row.month}（作成 ${row.generatedAt.replace("T", " ").slice(0, 16)}）">${monthLabel(row.month)}</a>
      </div>`;
  }).join("");

  element("legend").innerHTML = allNames().map((name) =>
    `<span class="key"><span class="sw" style="background:${colors.get(name) || "#90a4ae"}"></span>${name}</span>`).join("")
    + '<span class="key"><span class="sw" style="background:transparent;border-top:2px dashed #c62828;height:0"></span>予算上限</span>';

  // 月別の集計表（新しい月が上）
  const desc = [...asc].reverse();
  element("month-table").innerHTML = `
    <thead><tr><th>月</th><th>人日</th><th>人時</th><th>人件費</th><th>予算上限</th><th>差額</th><th>データ時点</th></tr></thead>
    <tbody>${desc.map((row) => {
      const days = Object.values(row.cost.perPerson).reduce((sum, p) => sum + p.days, 0);
      const hours = Object.values(row.cost.perPerson).reduce((sum, p) => sum + p.hours, 0);
      const diff = row.budgetMax != null ? row.budgetMax - row.cost.total : null;
      return `<tr>
        <td>${row.month}</td>
        <td>${days}日</td>
        <td>${Math.round(hours * 10) / 10}h</td>
        <td>${formatYen(row.cost.total)}</td>
        <td>${row.budgetMax != null ? formatYen(row.budgetMax) : "-"}</td>
        <td class="${diff == null ? "muted" : diff >= 0 ? "ok" : "over"}">${diff == null ? "-" : `${diff >= 0 ? "+" : ""}${formatYen(diff)}`}</td>
        <td class="muted">${row.generatedAt.replace("T", " ").slice(5, 16)}</td>
      </tr>`;
    }).join("")}</tbody>`;

  // 人別の内訳（行=人、列=月）
  const names = allNames().sort((a, b) => a.localeCompare(b, "ja"));
  element("person-table").innerHTML = `
    <thead><tr><th>人</th>${asc.map((row) => `<th>${monthLabel(row.month)}</th>`).join("")}<th>合計</th></tr></thead>
    <tbody>${names.map((name) => {
      let total = 0;
      const cells = asc.map((row) => {
        const p = row.cost.perPerson[name];
        if (!p) return '<td class="muted">-</td>';
        total += p.cost;
        return `<td title="${p.days}日・${p.hours}h">${formatYen(p.cost)}<br><span class="muted">${p.days}日 ${Math.round(p.hours)}h</span></td>`;
      }).join("");
      return `<tr><td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colorMap().get(name) || "#90a4ae"};margin-right:6px"></span>${name}</td>${cells}<td><b>${formatYen(total)}</b></td></tr>`;
    }).join("")}</tbody>`;
}

async function loadAll() {
  status("読み込み中…");
  const result = await api("/shift/months");
  const months = (result.months || []).slice(0, 12);  // 直近12か月まで
  if (!months.length) {
    status("シフトデータがまだありません。");
    return;
  }
  rows = await Promise.all(months.map((month) => loadMonth(month)));
  render();
  element("dash-area").hidden = false;
  status("");
}

window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;
  if (!["admin", "family"].includes(window.currentRole)) {
    alert("このページは admin / family のみアクセスできます");
    location.href = "/index.html";
    return;
  }
  renderHeader({ adminPage: true });
  element("page-area").hidden = false;
  element("login").addEventListener("click", () => login("/admin/labor/index.html"));

  if (!hasSession()) {
    element("login-area").hidden = false;
    return;
  }
  try {
    await loadAll();
  } catch (error) {
    if (!hasSession()) {
      element("login-area").hidden = false;
      status("");
      return;
    }
    status(error.message, true);
  }
});
