// annual-list.js（モーダル年選択 + 権限対応 + 新規年度作成 + DEBUG ログ）

import { loadJSON } from "/common/json.js";
import { openYearSelectModal } from "/common/filter/filter-year-simple.js";

window.addEventListener("DOMContentLoaded", () => {

  const loadBtn = document.getElementById("loadAnnual");
  const tableArea = document.getElementById("table-area");
  const yearSelector = document.getElementById("yearSelector");

  let annualAll = null;

  // ★ デバッグフラグ（ログ出力用）
  const DEBUG = true;

  /* ============================================================
     「年度を選択」ボタン → モーダルで年を選ぶ
  ============================================================ */
  loadBtn.addEventListener("click", async () => {
    try {
      annualAll = await loadJSON("/logs/schedule/annual/annual.json");

      if (DEBUG) {
        console.log("[DEBUG] annual.json 読み込み成功:", annualAll);
      }

      const years = Object.keys(annualAll).sort();

      openYearSelectModal({
        years,
        onSelect: (y) => {
          if (DEBUG) console.log("[DEBUG] モーダルで選択された年:", y);

          if (!y) {
            console.warn("[WARN] 年が選択されませんでした");
            return;
          }

          yearSelector.value = y;
          renderSelectedYear();
        }
      });

    } catch (e) {
      tableArea.innerHTML = `<p>annual.json の読み込みに失敗しました</p>`;
      console.error("[DEBUG] annual.json 読み込み失敗:", e);
    }
  });

  /* ============================================================
     選択された年だけ表示
  ============================================================ */
  function renderSelectedYear() {
    if (!annualAll) return;

    const y = yearSelector.value;

    if (DEBUG) {
      console.log(`[DEBUG] renderSelectedYear() 呼び出し`);
      console.log(`[DEBUG] yearSelector.value = "${y}"`);
    }

    if (!y) {
      if (DEBUG) console.log("[DEBUG] 年が空のため描画スキップ");
      return;
    }

    const data = annualAll[y];

    if (DEBUG) {
      console.log("[DEBUG] 年データ:", data);
    }

    const isAdmin = window.currentRole === "admin";

    /* ---------------------------------------------------------
       データが無い年（＝新規年度作成）
       → admin は編集画面へ遷移できる
    --------------------------------------------------------- */
    if (!data) {
      tableArea.innerHTML = `
        <div class="card">
          <h2>${y} 年の作付計画</h2>
          <p>この年度のデータはまだありません（新規作成）。</p>

          ${
            isAdmin
              ? `<a href="/schedule/annual/index.html?year=${y}" class="primary-btn">
                   新規作成（編集画面へ）
                 </a>`
              : `<span style="opacity:0.6;">閲覧のみ（編集不可）</span>`
          }
        </div>
      `;
      return;
    }

    /* ---------------------------------------------------------
       データがある年（通常表示）
    --------------------------------------------------------- */
    tableArea.innerHTML = `
      <div class="card">
        <h2>${y} 年の作付計画</h2>

        ${
          isAdmin
            ? `<a href="/schedule/annual/index.html?year=${y}" class="primary-btn">編集する</a>`
            : `<span style="opacity:0.6;">閲覧のみ（編集不可）</span>`
        }
      </div>
    `;
  }

});
