// common/collapse.js (OS標準のカードUIの簡易折りたたみ機能)
export function initCollapse(titleId, contentId) {
  const title = document.getElementById(titleId);
  const content = document.getElementById(contentId);

  if (!title || !content) return;

  // 初期状態は閉じる
  content.style.display = "none";
  title.textContent = `▶ ${title.textContent.replace(/^▶|▼\s*/, "")}`;

  title.addEventListener("click", () => {
    const isOpen = content.style.display === "block";
    content.style.display = isOpen ? "none" : "block";

    title.textContent = `${isOpen ? "▶" : "▼"} ${title.textContent.replace(/^▶|▼\s*/, "")}`;
  });
}
