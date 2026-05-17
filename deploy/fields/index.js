// analysis/index.js
import { loadJSON } from "/common/json.js";

// ▼ デバッグフラグ（true でログ ON）
const DEBUG_FIELD_LIST = true;

export async function renderFieldList() {
  const container = document.getElementById("analysis-container");
  container.innerHTML = ""; // 初期化

  // ★ fields.json 読み込み
  const fields = await loadJSON("data/fields.json");

  // ★ field-detail.json 読み込み（面積）
  const fieldDetail = await loadJSON("data/field-detail.json");

  if (DEBUG_FIELD_LIST) {
    console.group("[FIELD LIST DEBUG] 初期ロード情報");
    console.log("fields.length =", fields.length);
    console.log("fields サンプル =", fields.slice(0, 5));
    console.log("fieldDetail keys =", Object.keys(fieldDetail));
    console.groupEnd();
  }

  // ★ area（エリア）ごとにまとめる
  const groups = {};
  for (const f of fields) {
    const groupName = f.area || "その他";
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(f);
  }

  let totalAllHan = 0; // 全圃場の総計（反）

  // ★ グループごとに表示（折りたたみ対応）
  for (const [groupName, fieldList] of Object.entries(groups)) {

    let areaTotalHan = 0;

    const groupDiv = document.createElement("div");
    groupDiv.className = "field-group";

    // ▼ エリア名（クリックで開閉）
    const title = document.createElement("h2");
    title.textContent = `▶ ${groupName}`;
    title.className = "section-title group-title";

    // ▼ 折りたたみ用ラッパー（★印刷対応のため class を付ける）
    const wrap = document.createElement("div");
    wrap.className = "field-group-body";
    wrap.style.display = "none";

    // ★ colgroup を追加して列幅固定
    let tableHtml = `
      <table class="field-table">
        <colgroup>
          <col style="width:70%;">
          <col style="width:30%;">
        </colgroup>
        <thead>
          <tr>
            <th>圃場名</th>
            <th style="text-align:right;">耕作面積（反）</th>
          </tr>
        </thead>
        <tbody>
    `;

    fieldList.forEach(field => {
      const detail = fieldDetail[field.name];
      let sizeHan = 0;
      let display = "未入力";

      if (DEBUG_FIELD_LIST) {
        console.group(`[FIELD LIST DEBUG] 圃場: ${field.name}`);
        console.log("field =", field);
        console.log("detail =", detail);
        console.log("detail exists? =", !!detail);
        if (detail) {
          console.log("typeof detail.size =", typeof detail.size);
        }
      }

      if (detail && detail.size != null) {
        const sizeA = Number(detail.size);

        if (!isNaN(sizeA)) {
          sizeHan = sizeA / 10; // a → 反
          display = sizeHan.toFixed(2);

          if (DEBUG_FIELD_LIST) {
            console.log("parsed sizeA =", sizeA, "sizeHan =", sizeHan);
          }
        } else {
          if (DEBUG_FIELD_LIST) {
            console.log("size is string but not numeric → 未入力扱い");
          }
        }
      } else {
        if (DEBUG_FIELD_LIST) {
          console.log("detail.size が存在しない → 未入力扱い");
        }
      }

      if (DEBUG_FIELD_LIST) {
        console.groupEnd();
      }

      areaTotalHan += sizeHan;

      tableHtml += `
        <tr class="field-row" data-name="${field.name}">
          <td>${field.name}</td>
          <td style="text-align:right;">${display}</td>
        </tr>
      `;
    });

    tableHtml += `
        </tbody>
      </table>
      <div style="margin-top:4px; font-weight:bold;">
        ${groupName}エリア合計：${areaTotalHan.toFixed(2)}反
      </div>
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

    totalAllHan += areaTotalHan;
  }

  // ▼ 全体合計を下部に表示
  const totalDiv = document.createElement("div");
  totalDiv.style.marginTop = "20px";
  totalDiv.style.fontWeight = "bold";
  totalDiv.textContent = `全圃場合計：${totalAllHan.toFixed(2)}反`;
  container.appendChild(totalDiv);

  // ▼ 圃場クリック → 詳細ページへ
  attachEvents();
}

/* -----------------------------------------
   圃場クリック → 詳細ページへ
----------------------------------------- */
function attachEvents() {
  document.querySelectorAll(".field-row").forEach(row => {
    row.addEventListener("click", () => {
      const name = row.dataset.name;
      location.href = `/fields/index.html?field=${encodeURIComponent(name)}`;
    });
  });
}
