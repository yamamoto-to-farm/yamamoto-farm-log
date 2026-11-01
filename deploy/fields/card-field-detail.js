// card-field-detail.js
// 基本データカード。作付け（年サマリー）カードと同じ見た目の部品で組む。
export function renderFieldDetailCard(f, fieldName, TEMPLATE_FIELD) {

  const data = f ? f : { ...TEMPLATE_FIELD, __empty: true, field: fieldName };
  const isEmpty = data.__empty;
  const parcels = Array.isArray(data.parcels) ? data.parcels : [];
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];

  const section = (title, lines) => `
    <section class="year-summary-section">
      <h2 class="section-title year-summary-title">${escapeHtml(title)}</h2>
      <div class="info-block year-summary-block">
        ${lines.join("")}
      </div>
    </section>
  `;
  const line = (label, value) =>
    `<div class="info-line">${escapeHtml(label)}：${escapeHtml(valueOrPlaceholder(value))}</div>`;

  const basicSection = section("基本情報", [
    line("実耕作面積", `${valueOrPlaceholder(data.size)} a`),
    line("特徴", data.memo),
  ]);

  const parcelSections = parcels.length
    ? parcels.map((p, idx) => section(`筆${idx + 1}`, [
        line("所在", p?.address),
        line("登記面積", p?.officialArea ? `${p.officialArea} ㎡` : ""),
        line("地権者", p?.owner),
        line("利用権", p?.rightType),
        line("支払金額", p?.rent),
      ])).join("")
    : section("筆情報", ['<div class="info-line field-detail-empty-line">登録されていません</div>']);

  const contractSections = contracts.length
    ? contracts.map((c, idx) => section(`契約${idx + 1}`, [
        line("契約期間", `${valueOrPlaceholder(c?.start)} 〜 ${valueOrPlaceholder(c?.end)}`),
        line("賃料", c?.rent),
        line("備考", c?.notes),
      ])).join("")
    : section("契約情報", ['<div class="info-line field-detail-empty-line">登録されていません</div>']);

  return `
    <!-- ★ 基本データを年度カードと同じ階層にする -->
    <details class="basic-card">
      <summary>基本データ</summary>

      <div class="card year-summary-card field-detail-card" style="margin-top:12px;">

        <div class="year-summary-grid field-detail-grid">
          ${basicSection}
          ${parcelSections}
          ${contractSections}
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

function valueOrPlaceholder(value) {
  const text = String(value ?? "").trim();
  return text || "未入力";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
