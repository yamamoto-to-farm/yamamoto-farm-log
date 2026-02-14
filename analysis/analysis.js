// analysis.js

// CSV を読み込んで配列に変換する関数
async function loadCSV(url) {
  const text = await fetch(url).then(r => r.text());
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => obj[h] = cols[i]);
    return obj;
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  // URL から圃場名を取得
  const params = new URLSearchParams(location.search);
  const fieldName = params.get("field");

  // タイトルに圃場名を表示
  document.getElementById("field-name").textContent = fieldName;

  // CSV 読み込み
  const planting = await loadCSV("../data/planting.csv");
  const harvest = await loadCSV("../data/harvest.csv");
  const shipping = await loadCSV("../data/shipping.csv");

  // ★ 最新作付け
  const latestPlanting = planting
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  if (latestPlanting) {
    document.getElementById("latest-planting").innerHTML = `
      <div class="info-line">品目：${latestPlanting.crop}</div>
      <div class="info-line">品種：${latestPlanting.variety}</div>
      <div class="info-line">定植日：${latestPlanting.date}</div>
      <div class="info-line">面積：${latestPlanting.area}㎡</div>
    `;
  } else {
    document.getElementById("latest-planting").textContent = "データなし";
  }

  // ★ 最新収穫
  const latestHarvest = harvest
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  if (latestHarvest) {
    document.getElementById("latest-harvest").innerHTML = `
      <div class="info-line">収穫日：${latestHarvest.date}</div>
      <div class="info-line">収穫基数：${latestHarvest.count}</div>
    `;
  } else {
    document.getElementById("latest-harvest").textContent = "データなし";
  }

  // ★ 最新出荷
  const latestShipping = shipping
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  if (latestShipping) {
    document.getElementById("latest-shipping").innerHTML = `
      <div class="info-line">出荷日：${latestShipping.date}</div>
      <div class="info-line">重量：${latestShipping.weight}kg</div>
    `;
  } else {
    document.getElementById("latest-shipping").textContent = "データなし";
  }
});