// card-variety-detail.js
export function renderVarietyDetailCard(v, varietyName, TEMPLATE_VARIETY) {

  const data = v ? v : { ...TEMPLATE_VARIETY, __empty: true, variety: varietyName };
  const isEmpty = data.__empty;

  return `
    <div class="card basic-card">

      <!-- ★ タイトル（クリックで開閉） -->
      <h2 class="section-title basic-title" data-open="false">
        ▶ 基本データ
      </h2>

      <!-- ★ 中身（最初は閉じる） -->
      <div class="basic-body" style="display:none; margin-top:12px;">

        <!-- ★ 基本情報 -->
        <div class="info-line">メーカー：${data.maker || "未入力"}</div>
        <div class="info-line">播種期：${data.sowingPeriod || "未入力"}</div>
        <div class="info-line">収穫期：${data.harvestPeriod || "未入力"}</div>
        <div class="info-line">適した土質：${data.soilSuitability || "未入力"}</div>
        <div class="info-line">耐寒性：${data.coldTolerance || "未入力"}</div>
        <div class="info-line">特徴：${data.features || "未入力"}</div>

        <!-- ★ メモ -->
        <div class="info-block">
          <div class="info-block-title">【メモ】</div>
          <div class="info-line">
            ${data.memo ? data.memo.replace(/\n/g, "<br>") : "メモは登録されていません。"}
          </div>
        </div>

        <!-- ★ 編集ボタン -->
        ${
          isEmpty
            ? `
          <div class="info-line">この品種の基本データは登録されていません。</div>
          <button class="primary-btn"
            onclick="location.href='/admin/edit-json/?data=variety-detail&variety=${encodeURIComponent(varietyName)}'">
            基本情報を作成
          </button>
        `
            : `
          <button class="secondary-btn"
            onclick="location.href='/admin/edit-json/?data=variety-detail&variety=${encodeURIComponent(varietyName)}'">
            編集する
          </button>
        `
        }

      </div>
    </div>
  `;
}
