import { saveLog } from "../common/save/index.js";

// ===============================
// 権限チェック（analysis は family/admin のみ）
// ===============================
window.addEventListener("DOMContentLoaded", () => {
  if (!window.currentRole) {
    alert("アクセス権限がありません（PIN を入力してください）");
    location.href = "../map/index.html";
    return;
  }

  if (window.currentRole !== "family" && window.currentRole !== "admin") {
    alert("このページは家族のみ閲覧できます");
    location.href = "../map/index.html";
    return;
  }
});

// ===============================
// CSV を読み込んで配列に変換（無ければ空配列）
// ===============================
async function loadCSV(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",");

    return lines.slice(1).map(line => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || "");
      return obj;
    });

  } catch (e) {
    return [];
  }
}

// ===============================
// メイン処理
// ===============================
window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(location.search);
  const fieldName = params.get("field");

  // 圃場名が無い → 圃場一覧を表示
  if (!fieldName) {
    const fields = await fetch("../data/fields.json").then(r => r.json());

    document.body.innerHTML = `
      <h1>圃場を選択</h1>
      <ul id="field-list" style="padding-left:0;"></ul>
    `;

    const ul = document.getElementById("field-list");

    fields.forEach(f => {
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="index.html?field=${encodeURIComponent(f.name)}">
          ${f.name}
        </a>
      `;
      li.style.fontSize = "20px";
      li.style.margin = "12px 0";
      li.style.listStyle = "none";
      ul.appendChild(li);
    });

    return;
  }

  // 圃場名セット
  document.getElementById("field-name").textContent = fieldName;

  // CSV 読み込み
  const planting = await loadCSV("../logs/planting/all.csv");
  const harvest  = await loadCSV("../logs/harvest/all.csv");
  const shipping = await loadCSV("../logs/weight/all.csv");

  // ★ 作付け単収用：最新作付けの合計面積（㎡）
  let latestTotalAreaM2 = 0;

  // ===============================
  // 最新作付け（複数対応 + 面積計算 + 合計面積）
  // ===============================
  const plantingRows = planting.filter(r => r.field === fieldName);

  const latestDate = plantingRows
    .sort((a, b) => new Date(b.plantDate) - new Date(a.plantDate))[0]?.plantDate;

  const latestPlantings = plantingRows.filter(r => r.plantDate === latestDate);

  if (latestPlantings.length > 0) {

    let totalArea = 0;

    const html = latestPlantings.map(p => {
      const area =
        Number(p.quantity) *
        (Number(p.spacingRow) / 100) *
        (Number(p.spacingBed) / 100);

      totalArea += area;

      return `
        <div class="info-line">品種：${p.variety}</div>
        <div class="info-line">定植日：${p.plantDate}</div>
        <div class="info-line">株数：${p.quantity}</div>
        <div class="info-line">条間：${p.spacingRow}cm / 株間：${p.spacingBed}cm</div>
        <div class="info-line">作付け面積：約 ${area.toFixed(1)} ㎡</div>
        <div class="info-line">予定収穫：${p.harvestPlanYM}</div>
        <hr>
      `;
    }).join("");

    latestTotalAreaM2 = totalArea;

    const m2  = totalArea;
    const a   = m2 / 100;
    const tan = m2 / 1000;

    document.getElementById("latest-planting").innerHTML =
      html +
      `
        <div class="info-line" style="font-weight:bold; margin-top:10px;">
          合計作付け面積：${m2.toFixed(1)} ㎡
          （${tan.toFixed(2)} 反 / ${a.toFixed(2)} a）
        </div>
      `;

  } else {
    document.getElementById("latest-planting").textContent = "データなし";
  }

// ===============================
// 収穫サマリー（複数 plantingRef 対応）
// ===============================
const harvestRows = harvest.filter(r => r.field === fieldName);

if (harvestRows.length === 0) {
  document.getElementById("latest-harvest").textContent = "データなし";
} else {

  // ★ plantingRef ごとにグループ化
  const groups = {};
  harvestRows.forEach(r => {
    if (!groups[r.plantingRef]) groups[r.plantingRef] = [];
    groups[r.plantingRef].push(r);
  });

  let html = "";

  // ★ 各 plantingRef ごとにサマリーを作成
  for (const plantingRef of Object.keys(groups)) {

    const rows = groups[plantingRef].sort(
      (a, b) => new Date(a.harvestDate) - new Date(b.harvestDate)
    );

    const startDate = rows[0].harvestDate;
    const endDate   = rows[rows.length - 1].harvestDate;
    const count = rows.length;

    const totalBins = rows.reduce((sum, r) => sum + Number(r.bins), 0);

    const totalWeight = shipping
      .filter(s => s.field === fieldName && s.plantingRef === plantingRef)
      .reduce((sum, s) => sum + Number(s.totalWeight || 0), 0);

    const plantingRow = planting.find(p => p.plantingRef === plantingRef);
    const plantDate = plantingRow?.plantDate || "";

    let days = "";
    if (plantDate) {
      days = Math.floor(
        (new Date(startDate) - new Date(plantDate)) / (1000 * 60 * 60 * 24)
      );
    }

    let yieldPer10a = "";
    if (latestTotalAreaM2 > 0) {
      yieldPer10a = (totalWeight / (latestTotalAreaM2 / 1000)).toFixed(1);
    }

    const safeKey = plantingRef.replace(/[^a-zA-Z0-9_-]/g, "_");

    const summaryJson = {
      plantingRef,
      field: fieldName,
      variety: plantingRow?.variety || "",
      plantDate,
      harvestStart: startDate,
      harvestEnd: endDate,
      days,
      totalBins,
      totalWeight,
      areaM2: latestTotalAreaM2,
      yieldPer10a
    };

    const csvLine = [
      plantingRef,
      fieldName,
      plantingRow?.variety || "",
      plantDate,
      startDate,
      endDate,
      days,
      totalBins,
      totalWeight,
      latestTotalAreaM2,
      yieldPer10a
    ].join(",");

    // ★ <hr> を外に出し、ボタンは 1 個だけ
html += `
  <div class="summary-card">
    <div class="info-line">品種：${plantingRow?.variety || ""}</div>
    <div class="info-line">定植日：${plantDate}</div>
    <div class="info-line">収穫期間：${startDate} ～ ${endDate}</div>
    <div class="info-line">収穫回数：${count} 回</div>
    <div class="info-line">定植 → 初回収穫：${days} 日</div>
    <div class="info-line">合計収量：${totalBins} 基</div>
    <div class="info-line">合計重量：${totalWeight.toFixed(1)} kg</div>
    <div class="info-line">単収（作付け）：${yieldPer10a} kg/10a</div>

    <button class="save-btn"
            data-key="${safeKey}"
            data-json='${JSON.stringify(summaryJson)}'
            data-csv="${csvLine}">
      このサマリーを保存
    </button>
  </div>
  <hr>
`;

  }

  document.getElementById("latest-harvest").innerHTML = html;

  // ===============================
  // ★ 各サマリーの保存ボタン
  // ===============================
  document.querySelectorAll(".save-btn").forEach(btn => {
    btn.onclick = async () => {
      const safeKey = btn.dataset.key;
      const json = JSON.parse(btn.dataset.json);
      const csv = btn.dataset.csv;

      await saveLog("summary", safeKey, json, csv);
      alert(`サマリー（${json.variety}）を保存しました`);
    };
  });
}
});