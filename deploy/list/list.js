// ===============================
// list.js（モード管理・共通処理）
// ===============================

// URL パラメータ取得
const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "planting";

// モード切り替えボタンの active 表示
function updateModeButtons() {
  document.getElementById("btn-planting").classList.remove("active");
  document.getElementById("btn-seed").classList.remove("active");

  if (mode === "seed") {
    document.getElementById("btn-seed").classList.add("active");
  } else {
    document.getElementById("btn-planting").classList.add("active");
  }
}

// モード切り替えイベント
document.getElementById("btn-planting").addEventListener("click", () => {
  window.location.search = "?mode=planting";
});

document.getElementById("btn-seed").addEventListener("click", () => {
  window.location.search = "?mode=seed";
});

// 初期化
function initListPage() {
  updateModeButtons();

  if (mode === "seed") {
    renderSeedingList();
  } else {
    renderPlantingList();
  }
}

initListPage();
