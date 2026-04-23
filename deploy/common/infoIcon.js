// ===============================
// infoIcon.js（共通：ⓘ アイコン生成）
// ===============================
//
// 使い方：
//   infoIcon("SEED-2024-001", "seed")
//   infoIcon("PLANT-2024-015", "planting")
//
// data-id と data-type を持つ ⓘ アイコンを返す。
// list.js 側でクリックイベントを拾ってモーダルを開く。
// ===============================

export function infoIcon(id, type = "seed") {
  return `<span class="info-icon" data-id="${id}" data-type="${type}" style="cursor:pointer;color:#2b6cb0;font-weight:bold;display:block;line-height:1;">ⓘ</span>`;
}
