// print.js

window.addEventListener("DOMContentLoaded", () => {
  const data = window.printData;

  if (!data) {
    document.getElementById("print-root").textContent = "印刷データがありません";
    return;
  }

  // タイトル
  document.title = data.title;

  // 内容を挿入
  document.getElementById("print-root").innerHTML = `
    <h1>${data.title}</h1>
    ${data.html}
  `;

  // ★ 展開処理（CSS が適用された後なので確実に効く）
  document.querySelectorAll(".field-group > div").forEach(w => {
    w.style.display = "block";
  });

  // 印刷
  window.print();

  // 閉じる
  window.close();
});
