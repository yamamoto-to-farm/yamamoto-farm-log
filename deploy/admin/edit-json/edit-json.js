// admin/edit-json/edit-json.js
import { loadJSON } from "/common/json.js?v=1";

export async function initEditJson() {

  const params = new URLSearchParams(location.search);

  const dataName = params.get("data");
  const fieldName = params.get("field");
  const variety = params.get("variety");

  const container = document.getElementById("edit-container");
  container.innerHTML = "";

  // -----------------------------
  // ハブページ
  // -----------------------------
  if (!dataName) {
    renderJsonList(container);
    return;
  }

  // -----------------------------
  // 編集ページ
  // -----------------------------

  // ① /data/${dataName}.json
  const path1 = `/data/${dataName}.json`;

  // ② /data/${prefix}/${dataName}.json
  const prefix = dataName.split("-")[0];
  const path2 = `/data/${prefix}/${dataName}.json`;

  // ③ /data/${dataName}/${dataName}.json
  const path3 = `/data/${dataName}/${dataName}.json`;

  // チェック順
  const candidates = [path1, path2, path3];

  let finalPath = null;

  for (const p of candidates) {
    try {
      const head = await fetch(p, { method: "HEAD" });
      if (head.ok) {
        finalPath = p;
        break;
      }
    } catch {
      // 無視して次へ
    }
  }

  if (!finalPath) {
    alert("JSON ファイルが見つかりません: " + dataName);
    return;
  }

  // ④ JSON 読み込み
  const json = await loadJSON(finalPath);

  // ⑤ 編集カード読み込み
  const module = await import(`./card-edit-${dataName}.js`);

  // ⑥ 編集カードへ渡す
  module.renderEditCard({
    dataName,
    fieldName,
    variety,
    json,
    container,
    finalPath
  });
}


// -----------------------------
// JSON 一覧
// -----------------------------
function renderJsonList(container) {
  const sections = [
    {
      title: "圃場・品種",
      items: [
        {
          label: "圃場基本情報",
          file: "fields.json",
          data: "fields",
          desc: "圃場名・エリアなどの基本マスタ"
        },
        {
          label: "圃場詳細",
          file: "field-detail.json",
          data: "field-detail",
          desc: "面積・所在など圃場の詳細情報"
        },
        {
          label: "品種基本情報",
          file: "varieties.json",
          data: "varieties",
          desc: "品種名と種別の基本マスタ"
        },
        {
          label: "品種詳細情報",
          file: "variety-detail.json",
          data: "variety-detail",
          desc: "品種ごとの補足情報とメモ"
        }
      ]
    },
    {
      title: "資材マスタ",
      items: [
        {
          label: "肥料基本情報",
          file: "fertilizer-index.json",
          data: "fertilizer-index",
          desc: "肥料ID・カテゴリ・名称一覧"
        },
        {
          label: "肥料詳細情報",
          file: "fertilizer-detail.json",
          data: "fertilizer-detail",
          desc: "価格履歴・成分・メーカー情報"
        },
        {
          label: "農薬基本情報",
          file: "pesticide-index.json",
          data: "pesticide-index",
          desc: "農薬ID・カテゴリ・名称一覧"
        },
        {
          label: "農薬詳細情報",
          file: "pesticide-detail.json",
          data: "pesticide-detail",
          desc: "登録情報・希釈倍率・使用制限"
        }
      ]
    },
    {
      title: "権限・機械",
      items: [
        {
          label: "アクセス権限",
          file: "workers.json",
          data: "workers",
          desc: "ログインユーザーとロール設定"
        },
        {
          label: "機械",
          file: "machines.json",
          data: "machines",
          desc: "機械マスタ（QR連携対象）"
        }
      ]
    }
  ];

  const sectionHtml = sections.map(section => {
    const cards = section.items.map(item => `
      <div class="card" style="margin:0;">
        <h3 style="margin:0 0 8px;">${item.label}</h3>
        <p style="margin:0 0 8px; color:#555;">${item.file}</p>
        <p style="margin:0 0 14px; color:#666; font-size:0.95em;">${item.desc}</p>
        <button class="primary-btn" onclick="location.href='?data=${item.data}'">編集する</button>
      </div>
    `).join("");

    return `
      <section style="margin-bottom:26px;">
        <h2 style="margin:0 0 12px;">${section.title}</h2>
        <div style="display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));">
          ${cards}
        </div>
      </section>
    `;
  }).join("");

  container.insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-bottom:20px;">
      <h2 style="margin-bottom:6px;">JSON 編集一覧</h2>
      <p style="margin:0; color:#666;">編集したいデータをカテゴリから選んでください。</p>
    </div>
    ${sectionHtml}
  `);
}
