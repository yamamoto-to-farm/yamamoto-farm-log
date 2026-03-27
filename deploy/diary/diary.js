// admin/diary/diary.js
import { verifyLocalAuth } from "../common/ui.js";

// ▼ カードモジュール
import { renderCommonCard, initCommonCard } from "./card-common.js";
import { renderWorkTypeCard } from "./card-worktype.js";
import { renderFertilizerCard } from "./card-fertilizer.js";
import { renderPesticideCard } from "./card-pesticide.js";
import { renderOtherCard } from "./card-other.js";

window.addEventListener("DOMContentLoaded", async () => {

  // ▼ 認証チェック
  const ok = await verifyLocalAuth();
  if (!ok) return;

  const container = document.getElementById("diary-container");

  // ▼ URL パラメータ取得
  const params = new URLSearchParams(location.search);
  const typeParam = params.get("type");     // fertilizer / pesticide / other
  const fieldParam = params.get("field");   // 圃場名
  const workerParam = params.get("worker"); // 作業者名

  // ------------------------------------------------------------
  // ① 共通カードを差し込む
  // ------------------------------------------------------------
  container.insertAdjacentHTML("beforeend", renderCommonCard());
  await initCommonCard(); // 作業者・圃場の読み込み

  // ------------------------------------------------------------
  // ② 作業種別カードを差し込む
  // ------------------------------------------------------------
  container.insertAdjacentHTML("beforeend", renderWorkTypeCard());

  // ▼ 種別選択イベント
  document.getElementById("workType").addEventListener("change", (e) => {
    openWorkTypeCard(e.target.value, container);
  });

  // ------------------------------------------------------------
  // ③ URL パラメータで専用カードを自動展開
  // ------------------------------------------------------------
  if (typeParam) {
    openWorkTypeCard(typeParam, container);

    // ▼ UI の select も同期
    const select = document.getElementById("workType");
    if (select) select.value = typeParam;
  }

  // ------------------------------------------------------------
  // ④ 圃場の自動選択（?field=〇〇）
  // ------------------------------------------------------------
  if (fieldParam) {
    const boxes = document.querySelectorAll("#fields_box input[type=checkbox]");
    boxes.forEach(b => {
      if (b.value === fieldParam) b.checked = true;
    });
  }

  // ------------------------------------------------------------
  // ⑤ 作業者の自動選択（?worker=〇〇）
  // ------------------------------------------------------------
  if (workerParam) {
    const boxes = document.querySelectorAll("#workers_box input[type=checkbox]");
    boxes.forEach(b => {
      if (b.value === workerParam) b.checked = true;
    });
  }
});


// ------------------------------------------------------------
// 専用カードを開く関数（URL でも select でも共通）
// ------------------------------------------------------------
function openWorkTypeCard(type, container) {

  // 既存の専用カードを削除
  ["card-fertilizer", "card-pesticide", "card-other"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  // ▼ 種別ごとにカードを差し込む
  if (type === "fertilizer") {
    container.insertAdjacentHTML("beforeend", renderFertilizerCard());
  }
  if (type === "pesticide") {
    container.insertAdjacentHTML("beforeend", renderPesticideCard());
  }
  if (type === "other") {
    container.insertAdjacentHTML("beforeend", renderOtherCard());
  }
}