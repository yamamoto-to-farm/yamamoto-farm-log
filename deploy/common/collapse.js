// common/collapse.js (OS標準のカードUIの簡易折りたたみ機能)
function normalizeLabel(text) {
  return String(text || "")
    .replace(/^(?:▶|▼)\s*/, "")
    .trim();
}

function applyCollapseState(title, content, open, label) {
  content.style.display = open ? "block" : "none";
  title.textContent = `${open ? "▼" : "▶"} ${label}`;
}

export function initCollapse(titleId, contentId) {
  const title = document.getElementById(titleId);
  const content = document.getElementById(contentId);
  if (!title || !content) return;

  const label = title.dataset.collapseLabel || normalizeLabel(title.textContent);
  title.dataset.collapseLabel = label;

  // 既にバインド済みなら再バインドしない（再初期化で二重トグル化を防ぐ）
  if (title.dataset.collapseBound === "1") return;

  title.dataset.collapseBound = "1";
  applyCollapseState(title, content, false, label);

  title.addEventListener("click", () => {
    const isOpen = content.style.display === "block";
    applyCollapseState(title, content, !isOpen, label);
  });
}
