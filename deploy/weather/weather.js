import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1";
import { loadWeatherYear, classifyWeather, weatherIcon } from "/common/weather/weather.js?v=1";
import { todayLocalYmd } from "/common/date-utils.js?v=1";

let weatherChart = null;

function parseYmd(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDays(ymd, days) {
  const date = parseYmd(ymd);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return toYmd(date);
}

function previousYearDate(ymd) {
  const date = parseYmd(ymd);
  if (!date) return "";
  date.setFullYear(date.getFullYear() - 1);
  return toYmd(date);
}

function formatDate(ymd) {
  const date = parseYmd(ymd);
  if (!date) return "-";
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getMonth() + 1}/${date.getDate()}（${weekdays[date.getDay()]}）`;
}

function formatNumber(value, suffix = "") {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}${suffix}` : "-";
}

function buildDateKeys(start, end) {
  const startDate = parseYmd(start);
  const endDate = parseYmd(end);
  if (!startDate || !endDate || startDate > endDate) return [];

  const keys = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    keys.push(toYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

async function loadRows(dateKeys) {
  const years = new Set();
  dateKeys.forEach(date => {
    years.add(date.slice(0, 4));
    years.add(previousYearDate(date).slice(0, 4));
  });
  const dataByYear = Object.fromEntries(await Promise.all(
    [...years].filter(Boolean).map(async year => [year, await loadWeatherYear(year)])
  ));

  return dateKeys.map(date => {
    const row = dataByYear?.[date.slice(0, 4)]?.[date] || null;
    const previousDate = previousYearDate(date);
    const previousRow = dataByYear?.[previousDate.slice(0, 4)]?.[previousDate] || null;
    return { date, row, previousDate, previousRow };
  });
}

function renderSummary(rows) {
  const host = document.getElementById("weather-summary-line");
  if (!host) return;
  const observed = rows.filter(item => item.row);
  const precip = observed.reduce((sum, item) => sum + Number(item.row.precip || 0), 0);
  const avgTmax = observed.length ? observed.reduce((sum, item) => sum + Number(item.row.tmax || 0), 0) / observed.length : NaN;
  const avgTmin = observed.length ? observed.reduce((sum, item) => sum + Number(item.row.tmin || 0), 0) / observed.length : NaN;
  host.innerHTML = `
    <span class="weather-summary-chip">観測あり ${observed.length}/${rows.length}日</span>
    <span class="weather-summary-chip">降水量合計 ${formatNumber(precip, "mm")}</span>
    <span class="weather-summary-chip">平均最高 ${formatNumber(avgTmax, "℃")}</span>
    <span class="weather-summary-chip">平均最低 ${formatNumber(avgTmin, "℃")}</span>
  `;
}

function renderChart(rows, compareLastYear) {
  const canvas = document.getElementById("weather-chart");
  const status = document.getElementById("weather-chart-status");
  if (!canvas || typeof window.Chart !== "function") return;
  if (weatherChart) weatherChart.destroy();

  const labels = rows.map(item => formatDate(item.date));
  const currentTmax = rows.map(item => item.row?.tmax ?? null);
  const currentTmin = rows.map(item => item.row?.tmin ?? null);
  const precip = rows.map(item => item.row?.precip ?? null);
  const datasets = [
    {
      type: "bar",
      label: "降水量(mm)",
      data: precip,
      yAxisID: "yRain",
      backgroundColor: "rgba(59, 130, 246, 0.45)",
      borderColor: "#3b82f6",
      borderWidth: 1,
      order: 3
    },
    {
      type: "line",
      label: "最高気温(℃)",
      data: currentTmax,
      yAxisID: "yTemp",
      borderColor: "#dc2626",
      backgroundColor: "rgba(220, 38, 38, 0.1)",
      pointRadius: 2,
      borderWidth: 2,
      tension: 0.25,
      order: 1
    },
    {
      type: "line",
      label: "最低気温(℃)",
      data: currentTmin,
      yAxisID: "yTemp",
      borderColor: "#0ea5e9",
      backgroundColor: "rgba(14, 165, 233, 0.1)",
      pointRadius: 2,
      borderWidth: 2,
      tension: 0.25,
      order: 1
    }
  ];

  if (compareLastYear) {
    datasets.push(
      {
        type: "bar",
        label: "昨年降水量(mm)",
        data: rows.map(item => item.previousRow?.precip ?? null),
        yAxisID: "yRain",
        backgroundColor: "rgba(59, 130, 246, 0.18)",
        borderColor: "rgba(59, 130, 246, 0.58)",
        borderWidth: 1,
        order: 4
      },
      {
        type: "line",
        label: "昨年最高(℃)",
        data: rows.map(item => item.previousRow?.tmax ?? null),
        yAxisID: "yTemp",
        borderColor: "rgba(220, 38, 38, 0.48)",
        borderDash: [6, 4],
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0.25,
        order: 2
      },
      {
        type: "line",
        label: "昨年最低(℃)",
        data: rows.map(item => item.previousRow?.tmin ?? null),
        yAxisID: "yTemp",
        borderColor: "rgba(14, 165, 233, 0.48)",
        borderDash: [6, 4],
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0.25,
        order: 2
      }
    );
  }

  weatherChart = new window.Chart(canvas.getContext("2d"), {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 13 } } } },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 12 } } },
        yTemp: { type: "linear", position: "left", title: { display: true, text: "気温(℃)" } },
        yRain: { type: "linear", position: "right", title: { display: true, text: "降水量(mm)" }, beginAtZero: true, grid: { drawOnChartArea: false } }
      }
    }
  });

  const observed = rows.filter(item => item.row).length;
  if (status) status.textContent = `${formatDate(rows[0]?.date)}〜${formatDate(rows.at(-1)?.date)} / 観測 ${observed}日`;
}

function renderTable(rows, compareLastYear) {
  const tbody = document.getElementById("weather-table-body");
  if (!tbody) return;
  tbody.innerHTML = rows.map(item => {
    const row = item.row;
    const previous = item.previousRow;
    const weather = row ? classifyWeather(Number(row.precip || 0), Number(row.sunshine || 0)) : "-";
    const weatherText = row ? `${weatherIcon(weather)} ${weather}` : "-";
    return `<tr>
      <td><a href="/diary/index.html?date=${item.date}">${formatDate(item.date)}</a></td>
      <td>${weatherText}</td>
      <td>${formatNumber(row?.tmax, "℃")}</td>
      <td>${formatNumber(row?.tmin, "℃")}</td>
      <td>${formatNumber(row?.precip, "mm")}</td>
      <td>${compareLastYear ? formatNumber(previous?.tmax, "℃") : "-"}</td>
      <td>${compareLastYear ? formatNumber(previous?.tmin, "℃") : "-"}</td>
      <td>${compareLastYear ? formatNumber(previous?.precip, "mm") : "-"}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="8">期間を選択してください。</td></tr>';
}

async function refresh() {
  const start = document.getElementById("weather-start")?.value || "";
  const end = document.getElementById("weather-end")?.value || "";
  const compare = Boolean(document.getElementById("weather-compare-last-year")?.checked);
  const status = document.getElementById("weather-chart-status");
  const dateKeys = buildDateKeys(start, end);
  if (!dateKeys.length || dateKeys.length > 366) {
    if (status) status.textContent = "開始日と終了日を確認してください（最大366日）。";
    return;
  }
  if (status) status.textContent = "読み込み中…";
  const rows = await loadRows(dateKeys);
  renderSummary(rows);
  renderChart(rows, compare);
  renderTable(rows, compare);
}

function setRecentPeriod(days) {
  const latest = todayLocalYmd();
  const start = shiftDays(latest, -(days - 1));
  document.getElementById("weather-start").value = start;
  document.getElementById("weather-end").value = latest;
  refresh();
}

window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;
  renderHeader();
  document.getElementById("weather-page").style.display = "block";

  setRecentPeriod(30);
  document.getElementById("weather-apply")?.addEventListener("click", refresh);
  document.getElementById("weather-compare-last-year")?.addEventListener("change", refresh);
  document.querySelectorAll("[data-days]").forEach(button => {
    button.addEventListener("click", () => setRecentPeriod(Number(button.dataset.days)));
  });
});
