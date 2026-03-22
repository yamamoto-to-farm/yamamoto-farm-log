// card-field-detail.js
export function renderFieldDetailCard(f) {
  return `
    <div class="card basic-card">

      <!-- ▼ タイトル（クリックで開閉） -->
      <h2 class="basic-toggle">▼ 基本データ</h2>

      <!-- ▼ 中身（折りたたみ対象） -->
      <div class="basic-body">

        <div class="info-line">実耕作面積：${f.size ?? "-"} a</div>
        <div class="info-line">特徴：${f.memo ?? "-"}</div>

        ${f.soil ? `
          <div class="info-block">
            <div class="info-block-title">【土壌分析】</div>
            <div class="info-line">pH：${f.soil.ph ?? "-"}</div>
            <div class="info-line">EC：${f.soil.ec ?? "-"}</div>
            <div class="info-line">土質：${f.soil.texture ?? "-"}</div>
          </div>
        ` : ""}

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