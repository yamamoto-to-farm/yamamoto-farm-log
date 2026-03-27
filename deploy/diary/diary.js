// admin/diary/diary.js
import { verifyLocalAuth } from "../common/ui.js";

import { renderCommonCard, initCommonCard } from "./card-common.js";
import { renderFertilizerCard } from "./card-fertilizer.js";
import { renderPesticideCard } from "./card-pesticide.js";
import { renderOtherCard } from "./card-other.js";

// ▼ 一覧ページ（analysis/index と同じ思想）
function renderWorkTypeList() {
  return `
    <div class="card">
      <h2>作業種別を選択</h2>
      <ul class="link-list">
        <li><a href="?type=fertilizer">施肥</a></li>
        <li><a href="?type=pesticide">防除</a></li>
        <li><a href="?type=other">その他作業</a></li>
      </ul>
    </div>
  `;
}

export async function initDiaryPage() {
  const container = document.getElementById("page-area");

  // ▼ URL パラメータ取得
  const params = new URLSearchParams(location.search);
  const type = params.get("type");
  const fieldParam = params.get("field");

  // ▼ 認証（ログインユーザー名）
  const ok = await verifyLocalAuth();
  if (!ok) return;

  const user = localStorage.getItem("user");

  // ===============================
  // ① パラメータなし → 一覧ページ
  // ===============================
  if (!type) {
    container.innerHTML = renderWorkTypeList();
    return;
  }

  // ===============================
  // ② パラメータあり → 専用ページ
  // ===============================
  container.innerHTML = "";

  // ▼ 共通カード
  container.insertAdjacentHTML("beforeend", renderCommonCard());
  await initCommonCard();

  // ▼ ログインユーザーを自動選択
  if (user) {
    const boxes = document.querySelectorAll("#workers_box input[type=checkbox]");
    boxes.forEach(b => {
      if (b.value === user) b.checked = true;
    });
  }

  // ▼ 圃場の自動選択（URL → GPS → 手動）
  if (fieldParam) {
    const areaSel = document.getElementById("field_area");
    const manualSel = document.getElementById("field_manual");

    // エリアと圃場を探して選択
    [...manualSel.options].forEach(opt => {
      if (opt.value === fieldParam) {
        manualSel.value = fieldParam;
      }
    });
  }

  // ▼ 作業種別ごとのカード
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