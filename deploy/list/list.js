// ===============================
// list.js（モード管理・共通処理）
// ===============================

// URL パラメータ取得
export const params = new URLSearchParams(window.location.search);
export let mode = params.get("mode") || "planting";

// -------------------------------
// モード切り替えボタンの active 表示
// -------------------------------
function updateModeButtons() {
  const btnPlanting = document.getElementById("btn-planting");
  const btnSeed = document.getElementById("btn-seed");

  if (!btnPlanting || !btnSeed) return;

  btnPlanting.classList.remove("active");
  btnSeed.classList.remove("active");

  if (mode === "seed") {
    btnSeed.classList.add("active");
  } else {
    btnPlanting.classList.add("active");
  }
}

// -------------------------------
// モード切り替えイベント
// -------------------------------
function attachModeSwitchEvents() {
  const btnPlanting = document.getElementById("btn-planting");
  const btnSeed = document.getElementById("btn-seed");

  if (!btnPlanting || !btnSeed) return;

  btnPlanting.addEventListener("click", () => {
    window.location.search = "?mode=planting";
  });

  btnSeed.addEventListener("click", () => {
    window.location.search = "?mode=seed";
  });
}

// -------------------------------
// 初期化（認証後に list.html から呼ばれる）
// -------------------------------
export function initListPage() {
  // ボタン状態
  updateModeButtons();

  // イベント付与
  attachModeSwitchEvents();

  // モードに応じて描画
  if (mode === "seed") {
    if (typeof renderSeedingList === "function") {
      renderSeedingList();
    } else {
      console.error("renderSeedingList が見つかりません");
    }
  } else {
    if (typeof renderPlantingList === "function") {
      renderPlantingList();
    } else {
      console.error("renderPlantingList が見つかりません");
    }
  }
}
