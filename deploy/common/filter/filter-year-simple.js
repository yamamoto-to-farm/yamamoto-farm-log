// /common/filter/filter-year-simple.js
// 年だけを選ぶ簡易フィルタ（annual-list 用）

import { openModal, closeModal } from "./filter-ui.js";

export function openYearSelectModal({ years, onSelect }) {

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>年度を選択</h3>

        <div class="filter-block">
          ${years.map(y => `
            <div class="select-item" data-year="${y}">
              ${y} 年
            </div>
          `).join("")}
        </div>

        <div class="modal-footer">
          <button class="secondary-btn" id="cancel">閉じる</button>
        </div>
      </div>
    </div>
  `;

  openModal(html);

  // 閉じる
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };
  document.getElementById("cancel").onclick = closeModal;

  // 年クリック
  document.querySelectorAll("[data-year]").forEach(el => {
    el.onclick = () => {
      const y = el.dataset.year;
      closeModal();
      onSelect(y);
    };
  });
}
