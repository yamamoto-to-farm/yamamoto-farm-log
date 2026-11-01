// card-field-detail.js
// 基本データカード。作付け（年サマリー）カードと同じ見た目の部品で組む。
// レイアウト：左＝写真枠（常設）／右＝基本情報・筆情報・契約情報の縦積み。
// 筆・契約はサマリー1行表示＋クリックでモーダルに全件表示。
import { showInfoModal } from "/common/showInfoModal.js";

const valueOrPlaceholder = (value) => {
  const text = String(value ?? "").trim();
  return text || "未入力";
};

const line = (label, value) =>
  `<div class="info-line">${escapeHtml(label)}：${escapeHtml(valueOrPlaceholder(value))}</div>`;

// 複数の項目を1行にまとめる（狭い画面では自動で折り返す）
const inline = (pairs) => `<div class="info-line">${pairs
  .map(([label, value]) => `<span class="kv-inline">${escapeHtml(label)}：${escapeHtml(valueOrPlaceholder(value))}</span>`)
  .join("")}</div>`;

const getParcels = (data) => Array.isArray(data?.parcels) ? data.parcels : [];
const getContracts = (data) => Array.isArray(data?.contracts) ? data.contracts : [];

export function renderFieldDetailCard(f, fieldName, TEMPLATE_FIELD) {

  const data = f ? f : { ...TEMPLATE_FIELD, __empty: true, field: fieldName };
  const isEmpty = data.__empty;
  const parcels = getParcels(data);
  const contracts = getContracts(data);

  const section = (title, lines, { modal = "", chip = "" } = {}) => `
    <section class="year-summary-section${modal ? " field-detail-clickable" : ""}"
             ${modal ? `data-detail-modal="${modal}" role="button" tabindex="0" title="クリックで全件を表示"` : ""}>
      <h2 class="section-title year-summary-title">${escapeHtml(title)}${chip}</h2>
      <div class="info-block year-summary-block">
        ${lines.join("")}
      </div>
    </section>
  `;

  const basicSection = section("基本情報", [
    line("実耕作面積", `${valueOrPlaceholder(data.size)} a`),
    line("特徴", data.memo),
  ]);

  // 筆情報：圃場一覧と同様に先頭の所在を表示（件数はタイトル横のチップで）
  const parcelSummarySection = parcels.length
    ? section("筆情報", [
        line("所在", parcels[0]?.address),
      ], { modal: "parcels", chip: `<span class="field-address-chip">全${parcels.length}筆 ▸</span>` })
    : section("筆情報", ['<div class="info-line field-detail-empty-line">登録されていません</div>']);

  // 契約情報：先頭の契約期間＋賃料（件数はタイトル横のチップで）。全項目未入力なら明示
  const c0 = contracts[0];
  const contractHasContent = contracts.length &&
    [c0?.start, c0?.end, c0?.rent, c0?.notes].some(v => String(v ?? "").trim());
  const contractSummarySection = contracts.length
    ? section("契約情報", [
        contractHasContent
          ? inline([["契約期間", `${valueOrPlaceholder(c0?.start)} 〜 ${valueOrPlaceholder(c0?.end)}`], ["賃料", c0?.rent]])
          : '<div class="info-line field-detail-empty-line">内容未入力（クリックで詳細）</div>',
      ], { modal: "contracts", chip: `<span class="field-address-chip">全${contracts.length}件 ▸</span>` })
    : section("契約情報", ['<div class="info-line field-detail-empty-line">登録されていません</div>']);

  return `
    <!-- ★ 基本データを年度カードと同じ階層にする -->
    <details class="basic-card">
      <summary>基本データ</summary>

      <div class="card year-summary-card field-detail-card" style="margin-top:12px;">

        <div class="field-detail-top">
          <section class="year-summary-section field-photo-section">
            <h2 class="section-title year-summary-title">写真</h2>
            <div class="field-photo-slot">
              <div class="field-top-photo-placeholder">トップ写真なし</div>
            </div>
          </section>
          <div class="field-detail-stack">
            ${basicSection}
            ${parcelSummarySection}
            ${contractSummarySection}
          </div>
        </div>

        <!-- ★ 編集ボタン or 初期作成ボタン -->
        <div class="field-detail-actions">
        ${
          isEmpty
            ? `
          <span class="field-detail-empty-line">この圃場の基本データは登録されていません。</span>
          <button class="primary-btn"
            onclick="location.href='/admin/edit-json/?data=field-detail&field=${encodeURIComponent(fieldName)}'">
            基本情報を作成
          </button>
        `
            : `
          <button class="secondary-btn"
            onclick="location.href='/admin/edit-json/?data=field-detail&field=${encodeURIComponent(fieldName)}'">
            編集する
          </button>
        `
        }
        </div>

      </div>
    </details>
  `;
}

// 筆・契約サマリーのクリックでモーダルに全件表示（カード挿入後に呼ぶ）
export function bindFieldDetailCard(f, fieldName) {
  const data = f || {};
  const parcels = getParcels(data);
  const contracts = getContracts(data);

  const modalItem = (title, lines) => `
    <section class="year-summary-section field-detail-modal-item">
      <h3 class="section-title year-summary-title">${escapeHtml(title)}</h3>
      <div class="info-block year-summary-block">${lines.join("")}</div>
    </section>
  `;

  const builders = {
    parcels: () => showInfoModal(
      `${fieldName}：筆情報（全${parcels.length}筆）`,
      `<div class="field-detail-modal-list">${parcels.map((p, idx) => modalItem(`筆${idx + 1}`, [
        inline([["所在", p?.address], ["登記面積", p?.officialArea ? `${p.officialArea} ㎡` : ""]]),
        inline([["地権者", p?.owner], ["利用権", p?.rightType], ["支払金額", p?.rent]]),
      ])).join("")}</div>`
    ),
    contracts: () => showInfoModal(
      `${fieldName}：契約情報（全${contracts.length}件）`,
      `<div class="field-detail-modal-list">${contracts.map((c, idx) => modalItem(`契約${idx + 1}`, [
        inline([["契約期間", `${valueOrPlaceholder(c?.start)} 〜 ${valueOrPlaceholder(c?.end)}`],
                ["賃料", c?.rent], ["備考", c?.notes]]),
      ])).join("")}</div>`
    ),
  };

  for (const el of document.querySelectorAll(".field-detail-card [data-detail-modal]")) {
    const open = builders[el.dataset.detailModal];
    if (!open) continue;
    el.addEventListener("click", open);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
