// card-field-detail.js
export function renderFieldDetailCard(f) {

  // ★ データが空の場合（__empty フラグ付き）
  if (f.__empty) {
    return `
      <div class="card basic-card">
        <h2 class="basic-toggle">基本データ</h2>

        <div class="basic-body" style="display:none;">
          <div class="info-line">この圃場の基本データは登録されていません。</div>

          <!-- ★ 基本情報を作成ボタン -->
          <button class="primary-btn"
            onclick="location.href='/admin/edit-json/?field=${encodeURIComponent(f.field)}'">
            基本情報を作成
          </button>
        </div>
      </div>
    `;
  }

  // ★ 通常の基本データカード（※土壌分析は完全削除）
  return `
    <div class="card basic-card">

      <!-- ▼ タイトル（クリックで開閉） -->
      <h2 class="basic-toggle">基本データ</h2>

      <!-- ▼ 中身（折りたたみ対象） -->
      <div class="basic-body" style="display:none;">

        <div class="info-line">実耕作面積：${f.size ?? "-"} a</div>
        <div class="info-line">特徴：${f.memo ?? "-"}</div>

        <div class="info-block">
          <div class="info-block-title">【筆情報】</div>
          ${f.parcels.map(p => `
            <div class="info-line">
              ${p.lotNumber}（${p.landCategory} / ${p.officialArea}㎡ / ${p.owner} / ${p.rightType}）
            </div>
          `).join("")}
        </div>

      </div>
    </div>
  `;
}