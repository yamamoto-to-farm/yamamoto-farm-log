// analysis/index.js
import { loadJSON } from "/common/json.js";
import { buildExpiredFieldNameSet } from "/common/field-contract.js?v=1";

// ▼ デバッグフラグ（true でログ ON）
const DEBUG_FIELD_LIST = true;

export async function renderFieldList({ view = "active" } = {}) {
  const container = document.getElementById("analysis-container");
  container.innerHTML = ""; // 初期化

  // ★ fields.json 読み込み
  const fields = await loadJSON("data/fields.json");

  // ★ field-detail.json 読み込み（面積）
  const fieldDetail = await loadJSON("data/field-detail.json");

  const expiredSet = buildExpiredFieldNameSet(fieldDetail);
  const isExpiredView = view === "expired";
  const targetFields = fields.filter(f => isExpiredView ? expiredSet.has(f.name) : !expiredSet.has(f.name));

  container.insertAdjacentHTML("beforeend", `
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
      <button
        class="field-view-btn ${isExpiredView ? "" : "is-active"}"
        type="button"
        aria-current="${isExpiredView ? "false" : "page"}"
        onclick="location.href='/fields/index.html'"
      >
        稼働中の圃場一覧
      </button>
      <button
        class="field-view-btn ${isExpiredView ? "is-active" : ""}"
        type="button"
        aria-current="${isExpiredView ? "page" : "false"}"
        onclick="location.href='/fields/index.html?view=expired'"
      >
        契約終了した圃場一覧
      </button>
    </div>
  `);

  if (targetFields.length === 0) {
    container.insertAdjacentHTML("beforeend", `
      <div class="card" style="margin-top:8px; color:#555;">
        ${isExpiredView ? "契約終了した圃場はありません。" : "表示対象の圃場はありません。"}
      </div>
    `);
    return;
  }

  if (DEBUG_FIELD_LIST) {
    console.group("[FIELD LIST DEBUG] 初期ロード情報");
    console.log("fields.length =", fields.length);
    console.log("fields サンプル =", fields.slice(0, 5));
    console.log("fieldDetail keys =", Object.keys(fieldDetail));
    console.groupEnd();
  }

  // ★ area（エリア）ごとにまとめる
  const groups = {};
  for (const f of targetFields) {
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

    // ▼ 折りたたみ用ラッパー
    const wrap = document.createElement("div");
    wrap.style.display = "none";

    // ★ colgroup を追加して列幅固定
    let tableHtml = `
      <table class="field-table">
        <colgroup>
          <col style="width:42%;">
          <col style="width:38%;">
          <col style="width:20%;">
        </colgroup>
        <thead>
          <tr>
            <th>圃場名</th>
            <th class="field-address-col">所在</th>
            <th class="field-area-col">耕作面積（反）</th>
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

      const addressSummary = summarizeFieldAddress(detail);
      const addressTitleAttr = addressSummary.fullText
        ? ` title="${escapeHtml(addressSummary.fullText)}"`
        : "";
      const addressHtml = addressSummary.mainText === "未入力"
        ? `<span class="field-address-empty">未入力</span>`
        : `
          <span class="field-address-main">${escapeHtml(addressSummary.mainText)}</span>
          ${addressSummary.restCount > 0
            ? `<span class="field-address-chip">他${addressSummary.restCount}筆</span>`
            : ""
          }
        `;

      tableHtml += `
        <tr class="field-row" data-name="${field.name}">
          <td>${escapeHtml(field.name)}</td>
          <td class="field-address-col"${addressTitleAttr}>${addressHtml}</td>
          <td class="field-area-col">${display}</td>
        </tr>
      `;
    });

    tableHtml += `
        </tbody>
      </table>
      <div class="field-area-total-row">
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

function summarizeFieldAddress(detail) {
  if (!detail || typeof detail !== "object") {
    return {
      mainText: "未入力",
      restCount: 0,
      fullText: ""
    };
  }

  // 一覧は簡潔化: 先頭1件 + 他N筆
  if (Array.isArray(detail.parcels)) {
    const parcelAddresses = detail.parcels
      .map(p => String(p?.address || "").trim())
      .filter(v => v && v !== "未入力");

    if (parcelAddresses.length > 0) {
      const first = parcelAddresses[0];
      const rest = parcelAddresses.length - 1;
      return {
        mainText: first,
        restCount: rest,
        fullText: parcelAddresses.join("／")
      };
    }
  }

  // 旧形式の直接 address にも対応
  const direct = String(detail.address || "").trim();
  if (direct && direct !== "未入力") {
    return {
      mainText: direct,
      restCount: 0,
      fullText: direct
    };
  }

  return {
    mainText: "未入力",
    restCount: 0,
    fullText: ""
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
