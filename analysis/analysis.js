import { saveLog } from "../common/save/index.js";
import { verifyLocalAuth } from "/yamamoto-farm-log/common/ui.js";

// ===============================
// ページ読み込み → 認証チェック → メイン処理
// ===============================
window.addEventListener("DOMContentLoaded", async () => {

  const ok = await verifyLocalAuth();
  if (!ok) return;

  if (window.currentRole !== "family" && window.currentRole !== "admin") {
    alert("このページは家族のみ閲覧できます");
    location.href = "../map/index.html";
    return;
  }

  initAnalysisPage();
});


// ===============================
// ★ メイン処理
// ===============================
export async function initAnalysisPage() {

  const params = new URLSearchParams(location.search);
  const fieldName = params.get("field");

  if (!fieldName) {
    const fields = await fetch("/yamamoto-farm-log/data/fields.json").then(r => r.json());

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

  document.getElementById("field-name").textContent = fieldName;

  // ===============================
  // CSV 読み込み
  // ===============================
  console.log("🌱 planting/all.csv を読み込みます");
  const planting = await loadCSV("/yamamoto-farm-log/logs/planting/all.csv");

  console.log("🌾 harvest/all.csv を読み込みます");
  const harvest  = await loadCSV("/yamamoto-farm-log/logs/harvest/all.csv");

  console.log("⚖️ weight/all.csv を読み込みます");
  const shipping = await loadCSV("/yamamoto-farm-log/logs/weight/all.csv");

  if (planting.length === 0) {
    alert("planting/all.csv が読み込めていません。BOM や改行コード、カラム数を確認してください。");
  }

  let latestTotalAreaM2 = 0;

  // ===============================
  // 最新作付け（±30日）
  // ===============================
  const plantingRows = planting.filter(r => r.field === fieldName);

  const latestDate = plantingRows
    .sort((a, b) => new Date(b.plantDate) - new Date(a.plantDate))[0]?.plantDate;

  const latestDateObj = latestDate ? new Date(latestDate) : null;

  const latestPlantings = latestDateObj
    ? plantingRows.filter(r => {
        if (!r.plantDate) return false;
        const d = new Date(r.plantDate);
        const diffDays = Math.abs((d - latestDateObj) / (1000 * 60 * 60 * 24));
        return diffDays <= 30;
      })
    : [];

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

        <!-- ★ trayType を追加 -->
        <div class="info-line">株数：${p.quantity}（${p.trayType || "-"}穴）</div>

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
  // 収穫サマリー（plantingRef ごと）
  // ===============================
  const harvestRows = harvest.filter(r => r.field === fieldName);

  if (harvestRows.length === 0) {
    document.getElementById("latest-harvest").textContent = "データなし";
    return;
  }

  const groups = {};
  harvestRows.forEach(r => {
    if (!groups[r.plantingRef]) groups[r.plantingRef] = [];
    groups[r.plantingRef].push(r);
  });

  let html = "";

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

    // ★ trayType を summaryJson に追加
    const summaryJson = {
      plantingRef,
      field: fieldName,
      variety: plantingRow?.variety || "",
      trayType: plantingRow?.trayType || "",   // ★ 追加
      plantDate,
      harvestStart: startDate,
      harvestEnd: endDate,
      days,
      totalBins,
      totalWeight,
      areaM2: latestTotalAreaM2,
      yieldPer10a
    };

    // ★ CSV にも trayType を追加
    const csvLine = [
      plantingRef,
      fieldName,
      plantingRow?.variety || "",
      plantingRow?.trayType || "",   // ★ 追加
      plantDate,
      startDate,
      endDate,
      days,
      totalBins,
      totalWeight,
      latestTotalAreaM2,
      yieldPer10a
    ].join(",");

    html += `
      <div class="summary-card">
        <div class="info-line">品種：${plantingRow?.variety || ""}</div>
        <div class="info-line">定植日：${plantDate}</div>

        <!-- ★ trayType を表示 -->
        <div class="info-line">セルトレイ：${plantingRow?.trayType || "-"}穴</div>

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
  // サマリー保存ボタン
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


// ===============================
// CSV 読み込み
// ===============================
async function loadCSV(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.trim().split("\n");

    const headers = lines[0].split(",");

    const rows = lines.slice(1).map(line => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || "");
      return obj;
    });

    return rows;

  } catch (e) {
    console.error("❌ CSV読み込みエラー:", url, e);
    return [];
  }
}