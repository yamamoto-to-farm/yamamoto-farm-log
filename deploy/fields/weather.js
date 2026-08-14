import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1";
import { loadWeatherYear, classifyWeather, weatherIcon } from "/common/weather/weather.js?v=1";
import { setupSmartBackButton } from "/common/navigation-back.js?v=1";
import { todayLocalYmd } from "/common/date-utils.js?v=1";
import { showInfoModal } from "/common/showInfoModal.js?v=1";
import { loadJSON, saveJSON } from "/common/json.js?v=1";

const DEFAULT_GDD_API_URL = "https://lpbzml2cl3gtveyljy2ih6a4zm0rdzqo.lambda-url.ap-northeast-1.on.aws/";
const GDD_API_URL = window.GDD_API_URL || new URLSearchParams(location.search).get("gddApi") || DEFAULT_GDD_API_URL;
let weatherChart = null;
let latestComputedRows = [];
let latestGddThreshold = null;
let latestGddResult = null;
const HELP_CONTENT = {
  gdd: {
    title: "effective GDDとは",
    body: "0〜30℃に制限した平均気温から基準温度5℃を引いて積算するGDDです。計算式は max(min(平均気温, 30)-5, 0)。"
  },
  "gdd-cumulative": {
    title: "積算effective GDDとは",
    body: "定植日から当日までの effective GDD の合計です。Lambdaのeffectiveモードと同じ計算方式です。"
  },
  "gdd-effective": {
    title: "effective GDDとは",
    body: "平均気温を0〜30℃に制限し、5℃を差し引いて積算する採用方式のGDDです。計算式は max(min(平均気温, 30)-5, 0) です。"
  },
  "gdd-selected": {
    title: "採用GDDとは",
    body: "品種設定のGDD方式に基づいて、目標判定に使用しているGDDです。現在はeffective方式を採用しています。"
  },
  "gdd-target": {
    title: "目標到達GDDとは",
    body: "品種に登録された目標GDD、または目標重量から推定した到達目安です。累積GDDがこの値に達することを目標にします。"
  },
  "gdd-period": {
    title: "Lambda計算期間とは",
    body: "LambdaがS3の気象データからGDDを積算した開始日と終了日です。ページ側の集計期間と一致しているか確認できます。"
  }
};

function normalizeDate(value) {
  const text = String(value || "").trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function getVarietyFromPlantingRef(plantingRef) {
  const parts = String(plantingRef || "").trim().split("-");
  const variety = parts.length >= 3 ? parts[parts.length - 1].trim() : "";
  return variety || "";
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
  const clipped = Math.min(Math.max(avg, 0), 30);
  return Math.max(0, clipped - 5);
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
    <span class="kpi-chip">積算effective GDD <span class="help-trigger" tabindex="0" role="button" aria-label="積算effective GDDの説明" data-help-key="gdd-cumulative">?</span>: ${formatNumber(totalGdd, 1)}</span>
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
    const diaryUrl = buildDiaryDateUrl(item.date);
    const dateCell = `<a class="date-link" href="${diaryUrl}">${item.date}</a>`;

    if (!item.hasData) {
      return `
        <tr>
          <td>${dateCell}</td>
          <td colspan="8" style="color:#64748b;">データなし</td>
        </tr>
      `;
    }

    const rowClasses = [];
    if (item.tmax >= 33) rowClasses.push("weather-row-hot");
    if (item.precip >= 10) rowClasses.push("weather-row-rainy");

    return `
      <tr class="${rowClasses.join(" ")}">
        <td>${dateCell}</td>
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

function buildDiaryDateUrl(date) {
  const params = new URLSearchParams({
    date: String(date || "").trim(),
    return: `${location.pathname}${location.search}`
  });

  return `/diary/index.html?${params.toString()}`;
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

function renderWeatherChart(rows, options = {}) {
  const showTemp = Boolean(options.showTemp);
  const gddThreshold = parseNumber(options.gddThreshold, null);
  const canvas = document.getElementById("weather-chart");
  const empty = document.getElementById("chart-empty");
  if (!canvas || !empty) return;

  const valid = rows.filter(item => item.hasData);
  if (!valid.length || typeof window.Chart !== "function") {
    if (weatherChart) {
      weatherChart.destroy();
      weatherChart = null;
    }
    canvas.style.display = "none";
    empty.style.display = "block";
    return;
  }

  canvas.style.display = "block";
  empty.style.display = "none";

  const labels = valid.map(item => item.date.slice(5));
  const gddCumulative = valid.map(item => Number(item.gddCumulative.toFixed(1)));
  const precip = valid.map(item => Number(item.precip.toFixed(1)));
  const tmax = valid.map(item => Number(item.tmax.toFixed(1)));
  const tmin = valid.map(item => Number(item.tmin.toFixed(1)));

  if (weatherChart) {
    weatherChart.destroy();
  }

  const datasets = [
    {
      label: "積算effective GDD",
      data: gddCumulative,
      yAxisID: "yGdd",
      borderColor: "#1d4ed8",
      backgroundColor: "rgba(29, 78, 216, 0.16)",
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.25
    },
    ...(Number.isFinite(gddThreshold) ? [{
      label: "目標重量の推定GDD",
      data: valid.map(() => gddThreshold),
      yAxisID: "yGdd",
      borderColor: "#f97316",
      backgroundColor: "rgba(249, 115, 22, 0.12)",
      borderDash: [7, 5],
      pointRadius: 0,
      borderWidth: 2,
      tension: 0
    }] : []),
    {
      label: "降水量(mm)",
      data: precip,
      yAxisID: "yRain",
      type: "bar",
      backgroundColor: "rgba(14, 116, 144, 0.28)",
      borderColor: "rgba(14, 116, 144, 0.5)",
      borderWidth: 1,
      barPercentage: 0.9,
      categoryPercentage: 0.95
    }
  ];

  if (showTemp) {
    datasets.push(
      {
        label: "最高気温(℃)",
        data: tmax,
        yAxisID: "yTemp",
        borderColor: "#ea580c",
        backgroundColor: "rgba(234, 88, 12, 0.12)",
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0.25
      },
      {
        label: "最低気温(℃)",
        data: tmin,
        yAxisID: "yTemp",
        borderColor: "#0ea5e9",
        backgroundColor: "rgba(14, 165, 233, 0.12)",
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0.25
      }
    );
  }

  const ctx = canvas.getContext("2d");
  weatherChart = new window.Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: false,
            font: {
              size: 14
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 12,
            font: {
              size: 13
            }
          }
        },
        yGdd: {
          type: "linear",
          position: "left",
          title: {
            display: true,
            text: "積算GDD",
            font: {
              size: 14,
              weight: "600"
            }
          },
          ticks: {
            font: {
              size: 13
            }
          },
          grid: {
            drawOnChartArea: true
          }
        },
        yTemp: {
          type: "linear",
          position: "right",
          title: {
            display: true,
            text: "気温(℃)",
            font: {
              size: 14,
              weight: "600"
            }
          },
          ticks: {
            font: {
              size: 13
            }
          },
          grid: {
            drawOnChartArea: false
          }
        },
        yRain: {
          type: "linear",
          position: "right",
          offset: true,
          title: {
            display: true,
            text: "降水量(mm)",
            font: {
              size: 14,
              weight: "600"
            }
          },
          ticks: {
            font: {
              size: 13
            }
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

function bindChartToggle() {
  const checkbox = document.getElementById("temp-toggle");
  if (!checkbox) return;

  checkbox.checked = false;
  checkbox.addEventListener("change", () => {
    renderWeatherChart(latestComputedRows, {
      showTemp: checkbox.checked,
      gddThreshold: latestGddThreshold
    });
  });
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

function hideHelpPopover() {
  const popover = document.getElementById("help-popover");
  if (!popover) return;

  popover.classList.remove("is-open");
  popover.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".help-trigger[aria-expanded='true']").forEach(el => {
    el.setAttribute("aria-expanded", "false");
  });
}

function showHelpPopover(trigger, content) {
  const popover = document.getElementById("help-popover");
  const title = document.getElementById("help-popover-title");
  const body = document.getElementById("help-popover-body");
  if (!popover || !title || !body || !trigger || !content) return;

  title.textContent = content.title || "";
  body.textContent = content.body || "";

  const rect = trigger.getBoundingClientRect();
  const width = popover.offsetWidth || 280;
  const left = Math.min(
    Math.max(8, rect.left + window.scrollX - width / 2 + rect.width / 2),
    window.scrollX + window.innerWidth - width - 8
  );
  const top = rect.bottom + window.scrollY + 8;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.add("is-open");
  popover.setAttribute("aria-hidden", "false");
  trigger.setAttribute("aria-expanded", "true");
}

function bindHelpPopovers() {
  const triggers = document.querySelectorAll(".help-trigger[data-help-key]");
  if (!triggers.length) return;

  triggers.forEach(trigger => {
    if (trigger.dataset.helpBound === "true") return;
    trigger.dataset.helpBound = "true";
    trigger.setAttribute("aria-expanded", "false");
    const key = String(trigger.getAttribute("data-help-key") || "").trim();
    const content = HELP_CONTENT[key];
    if (!content) return;

    trigger.addEventListener("mouseenter", () => {
      showHelpPopover(trigger, content);
    });
    trigger.addEventListener("mouseleave", hideHelpPopover);
    trigger.addEventListener("focus", () => {
      showHelpPopover(trigger, content);
    });
    trigger.addEventListener("blur", hideHelpPopover);
    trigger.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        hideHelpPopover();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        hideHelpPopover();
        showInfoModal(content.title, `<p>${content.body}</p>`);
      }
    });

    trigger.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      hideHelpPopover();
      showInfoModal(content.title, `<p>${content.body}</p>`);
    });
  });

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".help-trigger")) return;
    hideHelpPopover();
  });

  window.addEventListener("scroll", hideHelpPopover, { passive: true });
  window.addEventListener("resize", hideHelpPopover);
}

function bindListDetailsSummary() {
  const details = document.querySelector(".list-details");
  const note = document.getElementById("list-summary-note");
  if (!details || !note) return;

  const sync = () => {
    note.textContent = details.open ? "タップで閉じる" : "タップで開く";
  };

  sync();
  details.addEventListener("toggle", sync);
}

function renderGddResult(result) {
  const container = document.getElementById("gdd-result");
  if (!container) return;

  const items = [
    ["現在のeffective GDD", result.effective_gdd, "gdd-effective"],
    ["採用GDD", result.selected_gdd, "gdd-selected"],
    ...(Number.isFinite(Number(result.estimated_gdd_for_target))
      ? [["目標到達GDD", result.estimated_gdd_for_target, "gdd-target"]]
      : [])
  ];

  if (result.calculation_start_date && result.calculation_end_date) {
    items.push([
      "Lambda計算期間",
      `${result.calculation_start_date} ～ ${result.calculation_end_date}`,
      "gdd-period"
    ]);
  }

  if (result.forecast) {
    items.push(
      ["残りGDD", result.forecast.remaining_gdd, "gdd-target"],
      ["平均effective GDD/日", result.forecast.average_daily_effective_gdd, "gdd-effective"],
      ["目標までの日数", result.forecast.estimated_days_to_target ?? "予測不可", "gdd-target"],
      ["目標到達予定日", result.forecast.estimated_target_date || "予測不可", "gdd-target"]
    );
  }

  container.innerHTML = items.map(([label, value, helpKey]) => {
    const displayValue = typeof value === "number" ? formatNumber(value, 2) : String(value ?? "-");
    return `
    <div class="gdd-result-item">
      <span class="gdd-result-label">${label} <span class="help-trigger" tabindex="0" role="button" aria-label="${label}の説明" data-help-key="${helpKey}">?</span></span>
      <span class="gdd-result-value">${displayValue}</span>
    </div>
  `;
  }).join("");
  container.hidden = false;
  bindHelpPopovers();
}

function updateTargetGddButtonState(params) {
  const button = document.getElementById("gdd-update-target-btn");
  if (!button) return;

  button.disabled = !params.get("harvestStart") || !latestGddResult;
}

async function updateVarietyTargetGdd(params) {
  const button = document.getElementById("gdd-update-target-btn");
  const status = document.getElementById("gdd-status");
  const plantingRef = params.get("plantingRef") || "";
  const variety = params.get("variety") || getVarietyFromPlantingRef(plantingRef) || "";
  const harvestDate = normalizeDate(params.get("harvestStart") || "");
  const targetPeriod = latestGddResult?.harvest_target_period
    || params.get("harvestTargetPeriod")
    || harvestDate.slice(0, 7);
  const selectedGdd = Number(latestGddResult?.selected_gdd);
  if (!button || !status || !variety || !Number.isFinite(selectedGdd) || selectedGdd < 0) return;

  if (!confirm(`品種「${variety}」の目標GDDを ${selectedGdd.toFixed(2)} に更新しますか？`)) return;

  button.disabled = true;
  status.textContent = "品種の目標GDDを保存しています。";
  try {
    const targets = await loadJSON("/data/gdd-targets.json");
    const current = targets[variety] && typeof targets[variety] === "object"
      ? targets[variety]
      : { mode: "effective", targets: {} };
    const currentTargets = current.targets && typeof current.targets === "object" ? current.targets : {};
    targets[variety] = {
      ...current,
      mode: "effective",
      targets: {
        ...currentTargets,
        [targetPeriod]: {
          ...(currentTargets[targetPeriod] || {}),
          targetGdd: Number(selectedGdd.toFixed(2)),
          status: "provisional",
          source: "harvest_record"
        }
      }
    };
    await saveJSON("data/gdd-targets.json", targets);
    status.textContent = `${targetPeriod}の目標GDDを ${selectedGdd.toFixed(2)} に更新しました。`;
  } catch (error) {
    status.textContent = `目標GDDの更新に失敗しました: ${error.message}`;
    button.disabled = false;
  }
}

function bindGddPrediction(params, periodEnd) {
  const button = document.getElementById("gdd-predict-btn");
  const status = document.getElementById("gdd-status");
  if (!button || !status) return;

  if (!GDD_API_URL) {
    button.disabled = true;
    status.textContent = "GDD API URLが未設定です。gddApiクエリまたはwindow.GDD_API_URLを設定してください。";
    return;
  }

  updateTargetGddButtonState(params);
  document.getElementById("gdd-update-target-btn")?.addEventListener("click", () => {
    updateVarietyTargetGdd(params);
  });

  button.addEventListener("click", async () => {
    const plantingRef = params.get("plantingRef") || "";
    const variety = params.get("variety") || getVarietyFromPlantingRef(plantingRef) || "新藍";

    button.disabled = true;
    status.classList.remove("is-error");
    status.textContent = "LambdaでGDD予測を計算しています。";

    try {
      const harvestDate = normalizeDate(params.get("harvestStart") || "");
      const requestDates = harvestDate
        ? { harvest_date: harvestDate }
        : { as_of_date: normalizeDate(periodEnd) };
      const response = await fetch(GDD_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planting_date: normalizeDate(params.get("plantDate") || ""),
          ...requestDates,
          variety,
          weather_bucket: params.get("weatherBucket") || undefined,
          harvest_target_period: params.get("harvestTargetPeriod") || undefined
        })
      });

      const responseText = await response.text();
      let envelope;
      try {
        envelope = JSON.parse(responseText);
      } catch {
        throw new Error(`APIエラー (${response.status}): ${responseText.slice(0, 160) || "応答が空です"}`);
      }

      const result = typeof envelope.body === "string"
        ? JSON.parse(envelope.body)
        : envelope.body || envelope;
      if (!response.ok || envelope.statusCode >= 400 || result.error) {
        throw new Error(result.error || `APIエラー (${response.status})`);
      }

      renderGddResult(result);
      latestGddResult = result;
      updateTargetGddButtonState(params);
      latestGddThreshold = parseNumber(result.estimated_gdd_for_target, null);
      const tempToggle = document.getElementById("temp-toggle");
      renderWeatherChart(latestComputedRows, {
        showTemp: Boolean(tempToggle?.checked),
        gddThreshold: latestGddThreshold
      });
      const periodText = result.calculation_start_date && result.calculation_end_date
        ? ` / ${result.calculation_start_date} ～ ${result.calculation_end_date}`
        : "";
      const targetText = result.target_gdd_source === "not_available"
        ? " / 目標GDD未設定"
        : "";
      status.textContent = `計算完了: ${result.weather_bucket || "気象データ取得元未表示"}${periodText}${targetText}`;
    } catch (error) {
      status.textContent = `GDD予測に失敗しました: ${error.message}`;
      status.classList.add("is-error");
    } finally {
      button.disabled = false;
    }
  });
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
  bindHelpPopovers();
  bindListDetailsSummary();
  setupSmartBackButton({
    elementId: "back-btn",
    fallbackPath: `/fields/index.html?field=${encodeURIComponent(params.get("field") || "")}`,
    defaultLabel: "元のページへ戻る"
  });

  const dateKeys = buildDateRange(plantDate, periodEnd);
  const weatherRows = await loadWeatherRowsForDates(dateKeys);
  const computedRows = buildComputedRows(weatherRows);
  latestComputedRows = computedRows;

  renderKpiLine(computedRows);
  renderInsights(computedRows);
  bindChartToggle();
  renderWeatherChart(computedRows, { showTemp: false });
  renderRows(computedRows);
  bindGddPrediction(params, periodEnd);

  const area = document.getElementById("page-area");
  if (area) area.style.display = "block";
}

main();
