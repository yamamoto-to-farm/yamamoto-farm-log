// analysis/index.js
import { loadJSON } from "/common/json.js";
import { safeFieldName } from "/common/utils.js";
import { buildExpiredFieldNameSet } from "/common/field-contract.js?v=1";
import { showPlantingDetailModal } from "/common/planting-detail.js?v=1";

const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

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

  // ★ 定植記録はあるが収穫記録がまだない圃場（＝栽培中）を判定
  const cultivatingFieldSet = await buildCultivatingFieldSet(targetFields);

  // ★ 栽培中圃場の耕作面積合計（反）
  let cultivatingAreaTotal = 0;
  targetFields.forEach(field => {
    if (!cultivatingFieldSet.has(field.name)) return;
    const detail = fieldDetail[field.name];
    const sizeA = detail && detail.size != null ? Number(detail.size) : NaN;
    if (!isNaN(sizeA)) cultivatingAreaTotal += sizeA / 10;
  });

  container.insertAdjacentHTML("beforeend", `
    <div class="field-view-toolbar">
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
      <label class="field-cultivating-toggle">
        <input type="checkbox" id="cultivating-toggle-checkbox">
        栽培中の圃場をハイライト表示
      </label>
      <span class="field-cultivating-total" id="cultivating-total-label">栽培中合計：${cultivatingAreaTotal.toFixed(2)}反</span>
    </div>
  `);

  const toggleCheckbox = document.getElementById("cultivating-toggle-checkbox");
  if (toggleCheckbox) {
    toggleCheckbox.addEventListener("change", () => {
      container.classList.toggle("show-cultivating", toggleCheckbox.checked);
    });
  }

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
    let cultivatingAreaTotalForGroup = 0;

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

      const isCultivating = cultivatingFieldSet.has(field.name);
      if (isCultivating) cultivatingAreaTotalForGroup += sizeHan;
      const cultivatingPlantingRef = cultivatingFieldSet.get(field.name) || "";

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

      const cultivatingIconHtml = isCultivating && cultivatingPlantingRef
        ? `<button type="button" class="field-cultivating-icon" data-planting-ref="${escapeHtml(cultivatingPlantingRef)}" title="栽培中の定植記録を見る">🌱</button>`
        : "";

      tableHtml += `
        <tr class="field-row${isCultivating ? " field-cultivating" : ""}" data-name="${field.name}">
          <td>${escapeHtml(field.name)}${cultivatingIconHtml}</td>
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
        <span class="field-area-total-breakdown">（栽培中：${cultivatingAreaTotalForGroup.toFixed(2)}反　空き圃場：${(areaTotalHan - cultivatingAreaTotalForGroup).toFixed(2)}反）</span>
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

  // ▼ 栽培中アイコンクリック → 定植記録モーダル（行クリックの詳細遷移は抑止）
  document.querySelectorAll(".field-cultivating-icon").forEach(icon => {
    icon.addEventListener("click", (event) => {
      event.stopPropagation();
      showPlantingDetailModal(icon.dataset.plantingRef, { canDiscard: window.currentRole === "admin" });
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

/* -----------------------------------------
   定植記録はあるが収穫記録がまだない圃場（＝栽培中）を判定
   戻り値: Map<圃場名, 最新のplantingRef>
----------------------------------------- */
async function buildCultivatingFieldSet(targetFields) {
  const summaryIndex = await loadJSON("data/summary-index.json").catch(() => ({}));

  const entries = await Promise.all(
    targetFields.map(async field => {
      const latestSummary = await loadLatestSummaryForField(summaryIndex, field.name);
      if (!latestSummary) return null;

      const hasHarvest = !!latestSummary.lifecycle?.hasHarvest || (
        !!latestSummary.harvest?.firstDate &&
        !!latestSummary.harvest?.lastDate &&
        latestSummary.harvest?.count > 0
      );

      // 全量破棄された作付けも「栽培中」からは除外する
      const discardedFully = !!latestSummary.lifecycle?.discardedFully;

      if (hasHarvest || discardedFully) return null;
      return [field.name, latestSummary.plantingRef || ""];
    })
  );

  return new Map(entries.filter(Boolean));
}

async function loadLatestSummaryForField(summaryIndex, fieldName) {
  const key = summaryIndex[fieldName] ? fieldName : safeFieldName(fieldName);
  const byYear = summaryIndex?.[key];
  if (!byYear || typeof byYear !== "object") return null;

  const years = Object.keys(byYear).sort();
  const latestYear = years[years.length - 1];
  const files = Array.isArray(byYear[latestYear]) ? byYear[latestYear] : [];
  if (files.length === 0) return null;

  // ファイル名は「日付-圃場名-品種」形式のため、日付順で最新を取得
  const latestFile = [...files].sort().at(-1);

  try {
    const url = `${CF_BASE}/logs/summary/${key}/${latestYear}/${latestFile}?ts=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
