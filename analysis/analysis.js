// ===============================
// 権限チェック（analysis は family/admin のみ）
// ===============================
window.addEventListener("DOMContentLoaded", () => {
  // PIN 未入力（＝currentRole が undefined）
  if (!window.currentRole) {
    alert("アクセス権限がありません（PIN を入力してください）");
    location.href = "../map/index.html";
    return;
  }

  // worker はアクセス禁止
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
      headers.forEach((h, i) => obj[h] = cols[i]);
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
  const planting = await loadCSV("./logs/planting/all.csv");
  const harvest = await loadCSV("./logs/harvest/all.csv");
  const shipping = await loadCSV("./logs/shipping/all.csv");

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
  } else {
    document.getElementById("latest-planting").textContent = "データなし";
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
  } else {
    document.getElementById("latest-harvest").textContent = "データなし";
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
  } else {
    document.getElementById("latest-shipping").textContent = "データなし";
  }
});