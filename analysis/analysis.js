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

  // ===============================
  // 最新作付け
  // ===============================
  const latestPlanting = planting
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.plantDate) - new Date(a.plantDate))[0];

  if (latestPlanting) {
    document.getElementById("latest-planting").innerHTML = `
      <div class="info-line">品種：${latestPlanting.variety}</div>
      <div class="info-line">定植日：${latestPlanting.plantDate}</div>
      <div class="info-line">株数：${latestPlanting.quantity}</div>
      <div class="info-line">予定収穫：${latestPlanting.harvestPlanYM}</div>
    `;
  } else {
    document.getElementById("latest-planting").textContent = "データなし";
  }

  // ===============================
  // 最新収穫
  // ===============================
  const latestHarvest = harvest
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.harvestDate) - new Date(a.harvestDate))[0];

  if (latestHarvest) {
    document.getElementById("latest-harvest").innerHTML = `
      <div class="info-line">収穫日：${latestHarvest.harvestDate}</div>
      <div class="info-line">収穫基数：${latestHarvest.bins}</div>
    `;
  } else {
    document.getElementById("latest-harvest").textContent = "データなし";
  }

  // ===============================
  // 最新出荷（計量）
  // ===============================
  const latestShipping = shipping
    .filter(r => r.field === fieldName)
    .sort((a, b) => new Date(b.shippingDate) - new Date(a.shippingDate))[0];

  if (latestShipping) {
    document.getElementById("latest-shipping").innerHTML = `
      <div class="info-line">出荷日：${latestShipping.shippingDate}</div>
      <div class="info-line">重量：${latestShipping.totalWeight}kg</div>
    `;
  } else {
    document.getElementById("latest-shipping").textContent = "データなし";
  }
});