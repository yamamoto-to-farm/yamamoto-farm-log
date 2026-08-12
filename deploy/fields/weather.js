import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1";
import { loadWeatherYear, classifyWeather, weatherIcon } from "/common/weather/weather.js?v=1";
import { setupSmartBackButton } from "/common/navigation-back.js?v=1";
import { todayLocalYmd } from "/common/date-utils.js?v=1";

const GDD_BASE = 10;

function normalizeDate(value) {
  const text = String(value || "").trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseDateOrNull(value) {
  const ymd = normalizeDate(value);
  if (!ymd) return null;
  const dt = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatNumber(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function toDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDateRange(startDate, endDate) {
  const start = parseDateOrNull(startDate);
  const end = parseDateOrNull(endDate);
  if (!start || !end || start > end) return [];

  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function parseNumber(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function calcDailyGdd(tmax, tmin) {
  const avg = (tmax + tmin) / 2;
  return Math.max(0, avg - GDD_BASE);
}

function calcEndDate(plantDate, harvestStart) {
  const today = todayLocalYmd();
  const harvest = normalizeDate(harvestStart);
  const plant = normalizeDate(plantDate);

  if (harvest && (!plant || harvest >= plant)) {
    return harvest;
  }

  return today;
}

async function loadWeatherRowsForDates(dateKeys) {
  const years = [...new Set(dateKeys.map(d => d.slice(0, 4)))];
  const yearPairs = await Promise.all(years.map(async year => [year, await loadWeatherYear(year)]));
  const weatherByYear = Object.fromEntries(yearPairs);

  return dateKeys.map(date => {
    const year = date.slice(0, 4);
    const row = weatherByYear?.[year]?.[date] || null;
    return { date, row };
  });
}

function renderKpiLine(rows) {
  const kpi = document.getElementById("kpi-line");
  if (!kpi) return;

  const valid = rows.filter(item => item.hasData);
  const days = rows.length;
  const observedDays = valid.length;

  const totalPrecip = valid.reduce((sum, item) => sum + item.precip, 0);
  const totalSunshine = valid.reduce((sum, item) => sum + item.sunshine, 0);
  const avgTmax = observedDays ? valid.reduce((sum, item) => sum + item.tmax, 0) / observedDays : NaN;
  const avgTmin = observedDays ? valid.reduce((sum, item) => sum + item.tmin, 0) / observedDays : NaN;
  const totalGdd = valid.reduce((sum, item) => sum + item.gdd, 0);

  kpi.innerHTML = `
    <span class="kpi-chip">対象日数: ${days}日</span>
    <span class="kpi-chip">観測あり: ${observedDays}日</span>
    <span class="kpi-chip">積算GDD(10): ${formatNumber(totalGdd, 1)}</span>
    <span class="kpi-chip">降水量合計: ${formatNumber(totalPrecip, 1)}mm</span>
    <span class="kpi-chip">日照時間合計: ${formatNumber(totalSunshine, 1)}h</span>
    <span class="kpi-chip">平均最高: ${formatNumber(avgTmax, 1)}℃</span>
    <span class="kpi-chip">平均最低: ${formatNumber(avgTmin, 1)}℃</span>
  `;
}

function renderRows(rows) {
  const tbody = document.getElementById("rows");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#666; padding:18px;">表示対象の期間がありません。</td></tr>';
    return;
  }

  const hasAnyData = rows.some(item => item.hasData);
  if (!hasAnyData) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#666; padding:18px;">この期間の気象データはありません。</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(item => {
    if (!item.hasData) {
      return `
        <tr>
          <td>${item.date}</td>
          <td colspan="8" style="color:#64748b;">データなし</td>
        </tr>
      `;
    }

    const rowClasses = [];
    if (item.tmax >= 33) rowClasses.push("weather-row-hot");
    if (item.precip >= 10) rowClasses.push("weather-row-rainy");

    return `
      <tr class="${rowClasses.join(" ")}">
        <td>${item.date}</td>
        <td>
          <span class="weather-type">
            <span class="weather-type-icon">${item.icon}</span>
            <span class="weather-type-text">${item.weatherType}</span>
          </span>
        </td>
        <td>${formatNumber(item.tmax, 1)}℃</td>
        <td>${formatNumber(item.tmin, 1)}℃</td>
        <td>${formatNumber(item.precip, 1)}mm</td>
        <td>${formatNumber(item.sunshine, 1)}h</td>
        <td>${formatNumber(item.tavg, 1)}℃</td>
        <td>${formatNumber(item.gdd, 1)}</td>
        <td>${formatNumber(item.gddCumulative, 1)}</td>
      </tr>
    `;
  }).join("");
}

function analyzeRows(rows) {
  const valid = rows.filter(item => item.hasData);
  if (!valid.length) {
    return {
      rainDays: 0,
      hotDays: 0,
      heavyRainDays: 0,
      maxDryStreak: 0,
      maxTempDay: null,
      maxRainDay: null
    };
  }

  const rainDays = valid.filter(item => item.precip >= 1).length;
  const hotDays = valid.filter(item => item.tmax >= 33).length;
  const heavyRainDays = valid.filter(item => item.precip >= 10).length;

  let maxDryStreak = 0;
  let dryStreak = 0;
  valid.forEach(item => {
    if (item.precip < 1) {
      dryStreak += 1;
      if (dryStreak > maxDryStreak) maxDryStreak = dryStreak;
    } else {
      dryStreak = 0;
    }
  });

  const maxTempDay = valid.reduce((best, item) => {
    if (!best || item.tmax > best.tmax) return item;
    return best;
  }, null);

  const maxRainDay = valid.reduce((best, item) => {
    if (!best || item.precip > best.precip) return item;
    return best;
  }, null);

  return {
    rainDays,
    hotDays,
    heavyRainDays,
    maxDryStreak,
    maxTempDay,
    maxRainDay
  };
}

function renderInsights(rows) {
  const line = document.getElementById("insight-line");
  const note = document.getElementById("insight-note");
  if (!line || !note) return;

  const stats = analyzeRows(rows);

  line.innerHTML = `
    <span class="insight-chip">雨日数(1mm以上): ${stats.rainDays}日</span>
    <span class="insight-chip">高温日数(33℃以上): ${stats.hotDays}日</span>
    <span class="insight-chip">強雨日数(10mm以上): ${stats.heavyRainDays}日</span>
    <span class="insight-chip">最大連続無降水: ${stats.maxDryStreak}日</span>
  `;

  const tempText = stats.maxTempDay
    ? `最高気温ピーク: ${stats.maxTempDay.date}（${formatNumber(stats.maxTempDay.tmax, 1)}℃）`
    : "最高気温ピーク: -";
  const rainText = stats.maxRainDay
    ? `最大降水日: ${stats.maxRainDay.date}（${formatNumber(stats.maxRainDay.precip, 1)}mm）`
    : "最大降水日: -";

  note.textContent = `${tempText} / ${rainText} / 表の薄橙は高温日、薄青は強雨日です。`;
}

function buildComputedRows(rawRows) {
  let gddCumulative = 0;

  return rawRows.map(item => {
    const source = item.row;
    if (!source) {
      return {
        date: item.date,
        hasData: false,
        gddCumulative
      };
    }

    const tmax = parseNumber(source.tmax);
    const tmin = parseNumber(source.tmin);
    const precip = parseNumber(source.precip, 0);
    const sunshine = parseNumber(source.sunshine, 0);

    if (!Number.isFinite(tmax) || !Number.isFinite(tmin)) {
      return {
        date: item.date,
        hasData: false,
        gddCumulative
      };
    }

    const tavg = (tmax + tmin) / 2;
    const gdd = calcDailyGdd(tmax, tmin);
    gddCumulative += gdd;

    const weatherType = classifyWeather(precip, sunshine);

    return {
      date: item.date,
      hasData: true,
      tmax,
      tmin,
      tavg,
      precip,
      sunshine,
      gdd,
      gddCumulative,
      weatherType,
      icon: weatherIcon(weatherType)
    };
  });
}

function bindMeta(params, periodEnd) {
  const field = params.get("field") || "";
  const fieldKey = params.get("fieldKey") || "";
  const plantDate = normalizeDate(params.get("plantDate") || "");
  const harvestStart = normalizeDate(params.get("harvestStart") || "");
  const plantingRef = String(params.get("plantingRef") || "").trim();

  const title = document.getElementById("page-title");
  if (title) {
    const suffix = plantingRef ? `（${plantingRef}）` : "";
    title.textContent = `${field || fieldKey} 気象データ${suffix}`;
  }

  const fieldInput = document.getElementById("field");
  const plantDateInput = document.getElementById("plant-date");
  const harvestStartInput = document.getElementById("harvest-start");
  const periodEndInput = document.getElementById("period-end");

  if (fieldInput) fieldInput.value = field || fieldKey;
  if (plantDateInput) plantDateInput.value = plantDate;
  if (harvestStartInput) harvestStartInput.value = harvestStart;
  if (periodEndInput) periodEndInput.value = periodEnd;

  const meta = document.getElementById("meta-line");
  if (meta) {
    const parts = [
      `作付け: ${plantDate || "-"} 〜 ${periodEnd || "-"}`,
      `収穫開始: ${harvestStart || "未収穫"}`
    ];
    if (plantingRef) parts.push(`作付けID: ${plantingRef}`);
    meta.textContent = parts.join(" / ");
  }
}

async function main() {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  renderHeader();

  if (window.currentRole !== "family" && window.currentRole !== "admin") {
    alert("このページは家族のみ閲覧できます");
    location.href = "/map/index.html";
    return;
  }

  const params = new URLSearchParams(location.search);
  const plantDate = normalizeDate(params.get("plantDate") || "");
  const harvestStart = normalizeDate(params.get("harvestStart") || "");
  const periodEnd = calcEndDate(plantDate, harvestStart);

  if (!plantDate) {
    alert("plantDate パラメータが必要です");
    location.href = "/fields/index.html";
    return;
  }

  bindMeta(params, periodEnd);
  setupSmartBackButton({
    elementId: "back-btn",
    fallbackPath: `/fields/index.html?field=${encodeURIComponent(params.get("field") || "")}`,
    defaultLabel: "元のページへ戻る"
  });

  const dateKeys = buildDateRange(plantDate, periodEnd);
  const weatherRows = await loadWeatherRowsForDates(dateKeys);
  const computedRows = buildComputedRows(weatherRows);

  renderKpiLine(computedRows);
  renderInsights(computedRows);
  renderRows(computedRows);

  const area = document.getElementById("page-area");
  if (area) area.style.display = "block";
}

main();
