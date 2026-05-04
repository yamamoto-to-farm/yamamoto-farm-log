// card-variety-summary.js（safeFileName + resolveFieldFromFileName 対応・最終安定版）
import { loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";
import { calcAreaM2, calcAreaTan } from "/varieties/analysis-utils.js";
import { resolveFieldFromFileName, safeFileName } from "/common/utils.js";

// ★ デバッグフラグ
const debugMode = true;

export async function renderVarietySummaryCards(varietyName) {

    let vIndex = {};
    try {
        vIndex = await loadJSON("/data/variety-index.json");
    } catch {
        return `<p>variety-index.json が読み込めませんでした</p>`;
    }

    const years = vIndex[varietyName];
    if (!years) return `<p>この品種の実績データはありません</p>`;

    let seedRows = [];
    try {
        seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));
    } catch {}

    let html = "";

    for (const year of Object.keys(years).sort()) {

        const { seed = [], planting = [] } = years[year];

        html += `
      <details>
        <summary>${year} 年</summary>
        <div class="year-block">
          <div class="card">
    `;

        /* -------------------------
           ★ 播種（seedRef）
        ------------------------- */
        if (seed.length > 0) {
            html += `<h3>播種</h3>`;

            seed.forEach(ref => {
                const row = seedRows.find(r => r.seedRef === ref);

                html += `
          <div class="seed-card">
            <div class="info-line">播種日：${row?.seedDate || "-"}</div>
            <div class="info-line">
              数量：${row?.trayCount || "-"}枚（${row?.trayType || "-"}穴）
            </div>
          </div>
        `;
            });
        }

        /* -------------------------
           ★ 定植（summary.json を使う）
        ------------------------- */
        if (planting.length > 0) {
            html += `<h3 style="margin-top:16px;">定植</h3>`;

            for (const p of planting) {
                const fileNameRaw = p.fileName; // variety-index.json の fileName（safeFileName 済み）
                const fileName = safeFileName(fileNameRaw.replace(".json", "")) + ".json";

                // ★ 年フォルダは fileName の先頭8桁から取得
                const date8 = fileName.slice(0, 8);
                const yearFromRef = date8.slice(0, 4);

                /* ----------------------------------------------------
                   ★ 1st: fileName → field を逆引き
                   （safeFileName + summary-index.json）
                ---------------------------------------------------- */
                const field = await resolveFieldFromFileName(fileName);

                if (debugMode) {
                    console.log("---- DEBUG planting item ----");
                    console.log("fileNameRaw:", fileNameRaw);
                    console.log("normalized fileName:", fileName);
                    console.log("date8:", date8);
                    console.log("yearFromRef:", yearFromRef);
                    console.log("resolved field:", field);
                }

                if (!field) {
                    html += `
            <div class="planting-card">
              <div class="info-line" style="color:#c00;">圃場名が特定できません（summary-index.json 未登録）</div>
            </div>
          `;
                    continue;
                }

                /* ----------------------------------------------------
                   ★ 正しい summary.json のパスを構築
                ---------------------------------------------------- */
                const summaryPath =
                    `/logs/summary/${encodeURIComponent(field)}/${yearFromRef}/${encodeURIComponent(fileName)}`;

                if (debugMode) {
                    console.log("summaryPath:", summaryPath);
                }

                /* ----------------------------------------------------
                   ★ summary.json を読み込む
                ---------------------------------------------------- */
                let summaryData = null;
                try {
                    summaryData = await loadJSON(summaryPath);
                } catch {
                    if (debugMode) {
                        console.error("[summary load failed]", summaryPath);
                    }
                    html += `
            <div class="planting-card">
              <div class="info-line" style="color:#c00;">summary.json が見つかりません</div>
            </div>
          `;
                    continue;
                }

                html += renderSummaryCard(summaryData);
            }
        }

        html += `
          </div>
        </div>
      </details>
    `;
    }

    return html;
}

/* ===============================
   summary.json → カードHTML
=============================== */
function renderSummaryCard(s) {

    const spacingText = `${s.planting.spacing.row}cm × ${s.planting.spacing.bed}cm`;
    const updatedJST = new Date(s.lastUpdated).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    const areaM2 =
        s.planting.areaM2 ??
        calcAreaM2(
            s.planting.quantity,
            s.planting.spacing.row,
            s.planting.spacing.bed
        );

    const areaTan =
        s.planting.areaTan ??
        calcAreaTan(areaM2);

    const first = s.harvest.firstDate;
    const last = s.harvest.lastDate;

    let harvestPeriod = "—";
    if (first && last) {
        const d1 = new Date(first);
        const d2 = new Date(last);
        const diff = Math.round((d2 - d1) / 86400000) + 1;
        harvestPeriod = `${first.slice(5)}〜${last.slice(5)}（${diff}日）`;
    }

    return `
    <div class="planting-card">

      <div class="info-line">
        圃場：
        <a href="/fields/index.html?field=${encodeURIComponent(s.planting.field)}">
          ${s.planting.field}
        </a>
      </div>

      <div class="info-line">品種：${s.planting.variety}</div>

      <div class="info-line">定植日：${s.planting.plantDate}</div>
      <div class="info-line">定植株数：${s.planting.quantity} 株（${s.planting.trayType || "-"}穴）</div>
      <div class="info-line">株間 × 条間：${spacingText}</div>

      <div class="info-line">作付面積：${areaTan.toFixed(2)}反（${areaM2.toFixed(1)}㎡）</div>

      <!-- ★ 収穫期間 + 回数を同じ行に -->
      <div class="info-line">
        収穫：${harvestPeriod} ／ ${s.harvest.count}回
      </div>

      <!-- ★ 収穫合計（基） + 反収（基/反） -->
      <div class="info-line">
        収穫合計：${s.harvest.totalAmount} 基（${s.shipping.totalWeight.toFixed(1)} kg）
        ／ 反収：${(s.harvest.totalAmount / areaTan).toFixed(1)} 基/反
      </div>

      <div class="info-line" style="font-size:12px; color:#666;">最終更新：${updatedJST}</div>
    </div>
  `;
}
