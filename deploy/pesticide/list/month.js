import {
  loadAllPesticideLogs,
  getPesticideByName
} from "./list-utils.js?v=1";
import { loadJSON } from "/common/json.js?v=1";

function getParams() {
  const url = new URL(location.href);
  return {
    year: Number(url.searchParams.get("year")),
    month: Number(url.searchParams.get("month")),
    pesticide: url.searchParams.get("pesticide")
  };
}

async function init() {
  const { year, month, pesticide } = getParams();

  document.getElementById("page-title").textContent =
    `${year}年 ${month}月 「${pesticide}」 防除詳細`;

  const [logs, detailMap, fieldDetailMap] = await Promise.all([
    loadAllPesticideLogs(),
    loadJSON("/data/pesticide/pesticide-detail.json").catch(() => ({})),
    loadJSON("/data/field-detail.json").catch(() => ({}))
  ]);

  const pesticideMaster = await getPesticideByName(pesticide);
  const pesticideDetail = findPesticideDetailByName(detailMap, pesticide);
  const chemicalUnit = String(pesticideDetail?.unit || pesticideMaster?.unit || "ml").toLowerCase();
  const packageInfo = normalizePackageInfo(pesticideDetail?.packaging, chemicalUnit);
  const fieldSizeMap = createFieldSizeMap(fieldDetailMap);
  const unit = "L";

  const container = document.getElementById("pesticide-detail-container");
  container.innerHTML = "";

  const result = createDateBlocks(logs, year, month, pesticide, {
    chemicalUnit,
    fieldSizeMap
  });
  result.blocks.forEach(b => container.appendChild(b));
  container.appendChild(createMonthlyTotal(result.rows, unit, {
    chemicalUnit,
    packageInfo
  }));
}

function createDateBlocks(logs, year, month, pesticideName, options = {}) {
  const rows = [];
  const chemicalUnit = options.chemicalUnit || "ml";
  const fieldSizeMap = options.fieldSizeMap || {};

  logs.forEach(field => {
    if (field.year !== year) return;

    field.entries.forEach(e => {
      const m = Number(String(e.date || "").slice(5, 7));
      if (m !== month) return;
      if (!Array.isArray(e.distributed)) return;

      e.distributed.forEach(p => {
        if (p.name !== pesticideName) return;

        rows.push({
          field: field.field,
          date: e.date,
          water_amount: Number(p.water_amount ?? p.spray_amount ?? 0),
          dilution_rate: Number(p.dilution_rate || 0),
          area_a: getFieldSizeA(fieldSizeMap, field.field),
          chemical_amount: getChemicalAmountByUnit(p, chemicalUnit),
          chemical_unit: chemicalUnit,
          unit: "L",
          workers: e.workers || "",
          notes: e.notes || ""
        });
      });
    });
  });

  rows.sort((a, b) => (a.date > b.date ? 1 : -1));

  const groups = {};
  rows.forEach(r => {
    if (!groups[r.date]) groups[r.date] = [];
    groups[r.date].push(r);
  });

  const blocks = [];

  Object.keys(groups).forEach(date => {
    const list = groups[date];
    const totalSpray = list.reduce((a, b) => a + Number(b.water_amount || 0), 0);
    const totalChemical = list.reduce((a, b) => a + Number(b.chemical_amount || 0), 0);
    const totalArea = list.reduce((a, b) => a + Number(b.area_a || 0), 0);
    const chemicalPer10a = totalArea > 0 ? (totalChemical / totalArea) * 10 : 0;
    const dilutionValues = Array.from(new Set(list.map(x => x.dilution_rate).filter(v => v > 0)));
    const dilutionText = dilutionValues.length ? `${dilutionValues.join(" / ")}倍` : "-";

    const details = document.createElement("details");
    details.className = "date-block";
    details.open = true;

    const summary = document.createElement("summary");
    const unit = list[0]?.unit || "L";
    const chemUnit = list[0]?.chemical_unit || "ml";
    summary.innerHTML = `${date}（${list.length}圃場 / ${formatNumber(totalSpray)}${unit} / ${dilutionText} / 薬量${formatNumber(chemicalPer10a)}${chemUnit}/10a）`;
    details.appendChild(summary);

    const table = document.createElement("table");
    table.className = "pest-table";

    table.innerHTML = `
      <thead>
        <tr>
          <th>圃場</th>
          <th>散布水量</th>
          <th>薬量</th>
          <th>薬量/10a</th>
          <th>希釈倍率</th>
          <th>作業者</th>
          <th>メモ</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement("tbody");

    list.forEach(r => {
      const fieldLink = `
        <a href="/fields/index.html?field=${encodeURIComponent(r.field)}" class="field-link">
          ${escapeHtml(r.field)}
        </a>
      `;

      const tr = document.createElement("tr");
      const chemicalPer10a = r.area_a > 0 ? (r.chemical_amount / r.area_a) * 10 : 0;
      tr.innerHTML = `
        <td>${fieldLink}</td>
        <td class="value">${formatNumber(r.water_amount)} ${escapeHtml(r.unit || "L")}</td>
        <td class="value">${formatNumber(r.chemical_amount)} ${escapeHtml(r.chemical_unit || "ml")}</td>
        <td class="value">${r.area_a > 0 ? `${formatNumber(chemicalPer10a)} ${escapeHtml(r.chemical_unit || "ml")}/10a` : "-"}</td>
        <td class="value">${r.dilution_rate > 0 ? `${formatNumber(r.dilution_rate)}倍` : "-"}</td>
        <td>${escapeHtml(r.workers)}</td>
        <td>${escapeHtml(r.notes)}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    details.appendChild(table);
    blocks.push(details);
  });

  return { rows, blocks };
}

function createMonthlyTotal(rows, unit, options = {}) {
  const dates = new Set(rows.map(r => r.date));
  const totalDays = dates.size;
  const totalSpray = rows.reduce((sum, r) => sum + Number(r.water_amount || 0), 0);
  const chemicalUnit = options.chemicalUnit || "ml";
  const totalChemical = rows.reduce(
    (sum, r) => sum + convertAmount(Number(r.chemical_amount || 0), r.chemical_unit, chemicalUnit),
    0
  );
  const totalArea = rows.reduce((sum, r) => sum + Number(r.area_a || 0), 0);
  const totalChemicalPer10a = totalArea > 0 ? (totalChemical / totalArea) * 10 : 0;

  const packText = buildPackageEstimateText(totalChemical, chemicalUnit, options.packageInfo);

  const div = document.createElement("div");
  div.style.marginTop = "20px";

  const table = document.createElement("table");
  table.className = "pest-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>月合計日数</th>
        <th>月合計散布水量</th>
        <th>月合計薬量</th>
        <th>月薬量/10a</th>
        <th>想定使用数</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="value">${totalDays} 日</td>
        <td class="total">${formatNumber(totalSpray)} ${escapeHtml(unit)}</td>
        <td class="total">${formatNumber(totalChemical)} ${escapeHtml(chemicalUnit)}</td>
        <td class="value">${totalArea > 0 ? `${formatNumber(totalChemicalPer10a)} ${escapeHtml(chemicalUnit)}/10a` : "-"}</td>
        <td class="value">${escapeHtml(packText)}</td>
      </tr>
    </tbody>
  `;

  div.appendChild(table);
  return div;
}

function createFieldSizeMap(fieldDetailMap) {
  const map = {};
  Object.entries(fieldDetailMap || {}).forEach(([name, detail]) => {
    map[name] = parseAreaA(detail?.size);
  });
  return map;
}

function getFieldSizeA(fieldSizeMap, fieldName) {
  return Number(fieldSizeMap?.[fieldName] || 0);
}

function parseAreaA(value) {
  const num = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function findPesticideDetailByName(detailMap, pesticideName) {
  const list = Object.values(detailMap || {});
  return list.find(d => d?.name === pesticideName) || null;
}

function getChemicalAmountByUnit(p, targetUnit) {
  const sourceUnit = String(p?.pesticide_unit || "").toLowerCase();
  const fromAmount = Number(p?.pesticide_amount ?? 0);

  if (fromAmount > 0 && sourceUnit) {
    return convertAmount(fromAmount, sourceUnit, targetUnit);
  }

  const waterL = Number(p?.water_amount ?? p?.spray_amount ?? 0);
  const dilution = Number(p?.dilution_rate || 0);
  if (!(waterL > 0) || !(dilution > 0)) return 0;

  const chemicalL = waterL / dilution;
  return convertAmount(chemicalL, "l", targetUnit);
}

function normalizePackageInfo(packaging, fallbackUnit) {
  const amount = Number(packaging?.amountPerPack ?? packaging?.size ?? 0);
  const unit = String(packaging?.unit || fallbackUnit || "ml").toLowerCase();
  const label = String(packaging?.packLabel || "本").trim() || "本";

  if (!(amount > 0)) return null;
  return {
    amountPerPack: amount,
    unit,
    packLabel: label
  };
}

function buildPackageEstimateText(totalChemical, totalUnit, packageInfo) {
  if (!packageInfo) return "規格未設定";

  const totalInPackUnit = convertAmount(totalChemical, totalUnit, packageInfo.unit);
  if (!(packageInfo.amountPerPack > 0)) return "規格未設定";

  const packs = totalInPackUnit / packageInfo.amountPerPack;
  return `${formatNumber(packs)}${packageInfo.packLabel}（規格 ${formatNumber(packageInfo.amountPerPack)}${packageInfo.unit}）`;
}

function convertAmount(amount, fromUnit, toUnit) {
  const from = String(fromUnit || "").toLowerCase();
  const to = String(toUnit || "").toLowerCase();
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return 0;
  if (from === to) return n;

  const volumeMl = toMl(n, from);
  if (volumeMl != null) {
    const converted = fromMl(volumeMl, to);
    return converted == null ? n : converted;
  }

  const weightG = toG(n, from);
  if (weightG != null) {
    const converted = fromG(weightG, to);
    return converted == null ? n : converted;
  }

  return n;
}

function toMl(value, unit) {
  if (unit === "ml" || unit === "cc") return value;
  if (unit === "l") return value * 1000;
  return null;
}

function fromMl(valueMl, unit) {
  if (unit === "ml" || unit === "cc") return valueMl;
  if (unit === "l") return valueMl / 1000;
  return null;
}

function toG(value, unit) {
  if (unit === "g") return value;
  if (unit === "kg") return value * 1000;
  return null;
}

function fromG(valueG, unit) {
  if (unit === "g") return valueG;
  if (unit === "kg") return valueG / 1000;
  return null;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(1).replace(/\.0$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

init();
