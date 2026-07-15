// card-field-detail.js
export function renderFieldDetailCard(f, fieldName, TEMPLATE_FIELD) {

  const data = f ? f : { ...TEMPLATE_FIELD, __empty: true, field: fieldName };
  const isEmpty = data.__empty;
  const parcels = Array.isArray(data.parcels) ? data.parcels : [];
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];

  const parcelHtml = parcels.length > 0
    ? `
      <div class="field-detail-item-grid">
        ${parcels
          .map(
            (p, idx) => `
              <section class="field-detail-item" aria-label="筆${idx + 1}">
                <h4 class="field-detail-item-title">筆${idx + 1}</h4>
                <dl class="field-detail-kv">
                  ${kvRow("所在", p?.address)}
                  ${kvRow("登記面積（㎡）", p?.officialArea)}
                  ${kvRow("地権者", p?.owner)}
                  ${kvRow("利用権", p?.rightType)}
                  ${kvRow("支払金額", p?.rent)}
                </dl>
              </section>
            `
          )
          .join("")}
      </div>
    `
    : `<div class="field-detail-empty">筆情報は登録されていません。</div>`;

  const contractHtml = contracts.length > 0
    ? `
      <div class="field-detail-item-grid">
        ${contracts
          .map(
            (c, idx) => `
              <section class="field-detail-item" aria-label="契約${idx + 1}">
                <h4 class="field-detail-item-title">契約${idx + 1}</h4>
                <dl class="field-detail-kv">
                  ${kvRow("契約期間", `${valueOrPlaceholder(c?.start)} 〜 ${valueOrPlaceholder(c?.end)}`)}
                  ${kvRow("賃料", c?.rent)}
                  ${kvRow("備考", c?.notes)}
                </dl>
              </section>
            `
          )
          .join("")}
      </div>
    `
    : `<div class="field-detail-empty">契約情報は登録されていません。</div>`;

  return `
    <!-- ★ 基本データを年度カードと同じ階層にする -->
    <details class="basic-card">
      <summary>基本データ</summary>

      <div class="card field-detail-card" style="margin-top:12px;">

        <!-- ★ 基本情報 -->
        <dl class="field-detail-kv field-detail-kv-top">
          ${kvRow("実耕作面積", `${valueOrPlaceholder(data.size)} a`)}
          ${kvRow("特徴", data.memo)}
        </dl>

        <!-- ★ 筆情報 -->
        <div class="field-detail-section">
          <h3 class="field-detail-section-title">筆情報</h3>
          ${parcelHtml}
        </div>

        <!-- ★ 契約情報 -->
        <div class="field-detail-section">
          <h3 class="field-detail-section-title">契約情報</h3>
          ${contractHtml}
        </div>

        <!-- ★ 編集ボタン or 初期作成ボタン -->
        ${
          isEmpty
            ? `
          <div class="field-detail-empty">この圃場の基本データは登録されていません。</div>

          <button class="primary-btn"
            onclick="location.href='/admin/edit-json/?data=field-detail&field=${encodeURIComponent(
              fieldName
            )}'">
            基本情報を作成
          </button>
        `
            : `
          <button class="secondary-btn"
            onclick="location.href='/admin/edit-json/?data=field-detail&field=${encodeURIComponent(
              fieldName
            )}'">
            編集する
          </button>
        `
        }

      </div>
    </details>
  `;
}

function valueOrPlaceholder(value) {
  const text = String(value ?? "").trim();
  return text || "未入力";
}

function kvRow(label, value) {
  return `
    <div class="field-detail-kv-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(valueOrPlaceholder(value))}</dd>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
