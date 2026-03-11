// summary-manager.js
// サマリー未生成一覧の表示と、生成ボタンの制御

/* ---------------------------------------------------------
   CSV 読み込み（summary.js と同じ loadCsv を使用）
--------------------------------------------------------- */
async function loadCsv(path) {
  const res = await fetch(path);
  const text = await res.text();
  return Papa.parse(text, { header: true }).data;
}

/* ---------------------------------------------------------
   サマリー存在チェック
--------------------------------------------------------- */
async function summaryExists(field, year, plantingRef) {
  const path = `summary/${field}/${year}/${plantingRef}.json`;
  const res = await fetch(path, { method: "GET" });
  return res.status === 200;
}

/* ---------------------------------------------------------
   plantingRef から field / year を抽出
--------------------------------------------------------- */
function parsePlantingRef(plantingRef) {
  const parts = plantingRef.split("-");
  const date = parts[0];
  const field = parts[1];
  const year = date.substring(0, 4);
  return { field, year };
}

/* ---------------------------------------------------------
   未生成サマリー一覧を取得
--------------------------------------------------------- */
async function getMissingSummaries() {
  const planting = await loadCsv("data/planting/all.csv");
  const missing = [];

  for (const p of planting) {
    const { field, year } = parsePlantingRef(p.plantingRef);
    const exists = await summaryExists(field, year, p.plantingRef);
    if (!exists) {
      missing.push(p);
    }
  }

  return missing;
}

/* ---------------------------------------------------------
   UI に一覧を描画
--------------------------------------------------------- */
function renderList(list) {
  const container = document.getElementById("summaryList");
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = "<p>すべてのサマリーが生成済みです。</p>";
    return;
  }

  for (const p of list) {
    const { field, year } = parsePlantingRef(p.plantingRef);

    const div = document.createElement("div");
    div.className = "item";

    div.innerHTML = `
      <div>
        <strong>${p.plantingDate}</strong> ${field} ${p.variety}
      </div>
      <button class="btn" data-ref="${p.plantingRef}">生成</button>
    `;

    container.appendChild(div);
  }

  // 個別生成ボタンにイベント付与
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const ref = e.target.dataset.ref;
      await generateOne(ref);
    });
  });
}

/* ---------------------------------------------------------
   個別生成
--------------------------------------------------------- */
async function generateOne(plantingRef) {
  const status = document.getElementById("status");
  status.textContent = `${plantingRef} を生成中…`;

  await summaryUpdate(plantingRef);

  status.textContent = `${plantingRef} の生成が完了しました。`;

  // 再読み込みして一覧更新
  const missing = await getMissingSummaries();
  renderList(missing);
}

/* ---------------------------------------------------------
   一括生成
--------------------------------------------------------- */
async function generateAll() {
  const status = document.getElementById("status");
  status.textContent = "すべてのサマリーを生成中…";

  await summaryUpdateAll();

  status.textContent = "すべてのサマリー生成が完了しました。";

  // 再読み込みして一覧更新
  const missing = await getMissingSummaries();
  renderList(missing);
}

/* ---------------------------------------------------------
   初期化
--------------------------------------------------------- */
async function init() {
  const missing = await getMissingSummaries();
  renderList(missing);

  document.getElementById("generateAll").addEventListener("click", generateAll);
}

init();