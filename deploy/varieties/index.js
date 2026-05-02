// varieties/index.js
import { loadJSON } from "/common/json.js";

// ▼ デバッグフラグ
const DEBUG_VARIETY_LIST = false;

export async function renderVarietyList() {
  const container = document.getElementById("variety-container");
  container.innerHTML = ""; // 初期化

  // ★ varieties.json 読み込み
  const varieties = await loadJSON("/data/varieties.json");

  // ★ variety-detail.json 読み込み（生育日数・反収など）
  const varietyDetail = await loadJSON("/data/variety-detail.json");

  if (DEBUG_VARIETY_LIST) {
    console.group("[VARIETY LIST DEBUG] 初期ロード情報");
    console.log("varieties.length =", varieties.length);
    console.log("varieties サンプル =", varieties.slice(0, 5));
    console.log("varietyDetail keys =", Object.keys(varietyDetail));
    console.groupEnd();
  }

  // ★ type（品種グループ）ごとにまとめる
  const groups = {};
  for (const v of varieties) {
    const groupName = v.type || "その他";
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(v);
  }

  // ★ グループごとに表示（折りたたみ対応）
  for (const [groupName, varietyList] of Object.entries(groups)) {

    const groupDiv = document.createElement("div");
    groupDiv.className = "variety-group";

    // ▼ グループタイトル
    const title = document.createElement("h2");
    title.textContent = `▶ ${groupName}`;
    title.className = "section-title group-title";

    // ▼ 折りたたみラッパー
    const wrap = document.createElement("div");
    wrap.style.display = "none";

    let tableHtml = `
      <table class="variety-table">
        <thead>
          <tr>
            <th>品種名</th>
            <th style="text-align:right;">生育日数</th>
            <th style="text-align:right;">反収</th>
          </tr>
        </thead>
        <tbody>
    `;

    varietyList.forEach(v => {
      const detail = varietyDetail[v.name] || {};

      const growDays = detail.growDays ?? "未入力";
      const yieldPer10a = detail.yieldPer10a ?? "未入力";

      tableHtml += `
        <tr class="variety-row" data-name="${v.name}">
          <td>${v.name}</td>
          <td style="text-align:right;">${growDays}</td>
          <td style="text-align:right;">${yieldPer10a}</td>
        </tr>
      `;
    });

    tableHtml += `
        </tbody>
      </table>
    `;

    wrap.innerHTML = tableHtml;

    // ▼ タイトルクリックで開閉
    title.addEventListener("click", () => {
      const isOpen = wrap.style.display === "block";
      wrap.style.display = isOpen ? "none" : "block";
      title.textContent = `${isOpen ? "▶" : "▼"} ${groupName}`;
    });

    groupDiv.appendChild(title);
    groupDiv.appendChild(wrap);
    container.appendChild(groupDiv);
  }

  // ▼ 品種クリック → 詳細ページへ
  attachEvents();
}

/* -----------------------------------------
   品種クリック → 詳細ページへ
----------------------------------------- */
function attachEvents() {
  document.querySelectorAll(".variety-row").forEach(row => {
    row.addEventListener("click", () => {
      const name = row.dataset.name;
      location.href = `/varieties/index.html?variety=${encodeURIComponent(name)}`;
    });
  });
}
