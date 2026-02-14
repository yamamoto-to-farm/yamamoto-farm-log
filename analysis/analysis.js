// analysis.js

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
  const params = new URLSearchParams(location.search);
  const fieldName = params.get("field");

  // ★ 圃場名が無い場合 → 圃場一覧を表示して終了
  if (!fieldName) {
    const fields = await fetch("../data/fields.json").then(r => r.json());

    document.body.innerHTML = `
      <h1>圃場を選択</h1>
      <ul id="field-list"></ul>
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
      ul.appendChild(li);
    });

    return; // ★ ここで終了（以下は field があるときだけ実行）
  }

  // ★ ここから通常の analysis ページ処理
  document.getElementById("field-name").textContent = fieldName;

  const planting = await loadCSV("../data/planting.csv");
  const harvest = await loadCSV("../data/harvest.csv");
  const shipping = await loadCSV("../data/shipping.csv");

  // 最新作付け
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
  }

  // 最新収穫
  const latestHarvest = harvest
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  if (latestHarvest) {
    document.getElementById("latest-harvest").innerHTML = `
      <div class="info-line">収穫日：${latestHarvest.date}</div>
      <div class="info-line">収穫基数：${latestHarvest.count}</div>
    `;
  }

  // 最新出荷
  const latestShipping = shipping
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  if (latestShipping) {
    document.getElementById("latest-shipping").innerHTML = `
      <div class="info-line">出荷日：${latestShipping.date}</div>
      <div class="info-line">重量：${latestShipping.weight}kg</div>
    `;
  }
});