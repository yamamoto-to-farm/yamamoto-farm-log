// card-variety-detail.js
export function renderVarietyDetailCard(v, varietyName, TEMPLATE_VARIETY) {

  const data = v ? v : { ...TEMPLATE_VARIETY, __empty: true, variety: varietyName };
  const isEmpty = data.__empty;

  return `
    <!-- 基本データ -->
    <h2 class="section-title toggle-title" data-target="basic-card" data-open="false">
      基本データ
    </h2>

    <div id="basic-card" class="card toggle-body" style="display:none;">
      <div class="info-line">メーカー：${data.maker || "未入力"}</div>
      <div class="info-line">播種期：${data.sowingPeriod || "未入力"}</div>
      <div class="info-line">収穫期：${data.harvestPeriod || "未入力"}</div>
      <div class="info-line">適した土質：${data.soilSuitability || "未入力"}</div>
      <div class="info-line">耐寒性：${data.coldTolerance || "未入力"}</div>
      <div class="info-line">特徴：${data.features || "未入力"}</div>
    </div>

    <!-- メモ -->
    <h2 class="section-title toggle-title" data-target="memo-card" data-open="false">
      メモ
    </h2>

    <div id="memo-card" class="card toggle-body" style="display:none;">
      <div class="info-line">
        ${data.memo ? data.memo.replace(/\n/g, "<br>") : "メモは登録されていません。"}
      </div>
    </div>

    <!-- 編集ボタン -->
    <div class="card">
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
  `;
}
