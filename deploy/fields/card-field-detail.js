// card-field-detail.js
export function renderFieldDetailCard(f, fieldName, TEMPLATE_FIELD) {

  const data = f ? f : { ...TEMPLATE_FIELD, __empty: true, field: fieldName };
  const isEmpty = data.__empty;

  return `
    <!-- ★ 基本データを年度カードと同じ階層にする -->
    <details class="basic-card">
      <summary>基本データ</summary>

      <div class="card" style="margin-top:12px;">

        <!-- ★ 基本情報 -->
        <div class="info-line">実耕作面積：${data.size} a</div>
        <div class="info-line">特徴：${data.memo}</div>

        <!-- ★ 筆情報 -->
        <div class="info-block">
          <div class="info-block-title">【筆情報】</div>

          ${data.parcels
            .map(
              p => `
            <div class="info-line">
              【所在】${p.address}　
              【登記面積】${p.officialArea}　
              【地権者】${p.owner}　
              【利用権】${p.rightType}　
              【支払金額】${p.rent}
            </div>
          `
            )
            .join("")}
        </div>

        <!-- ★ 契約情報 -->
        <div class="info-block">
          <div class="info-block-title">【契約情報】</div>

          ${
            data.contracts && data.contracts.length > 0
              ? data.contracts
                  .map(
                    c => `
              <div class="info-line">
                契約期間：${c.start} 〜 ${c.end}　
                賃料：${c.rent}　
                備考：${c.notes}
              </div>
            `
                  )
                  .join("")
              : `<div class="info-line">契約情報は登録されていません。</div>`
          }
        </div>

        <!-- ★ 編集ボタン or 初期作成ボタン -->
        ${
          isEmpty
            ? `
          <div class="info-line">この圃場の基本データは登録されていません。</div>

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
