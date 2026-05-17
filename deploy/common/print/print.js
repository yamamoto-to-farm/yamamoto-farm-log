// /common/print/print.js

window.addEventListener("DOMContentLoaded", () => {
  const data = window.printData;

  if (!data) {
    document.getElementById("print-root").textContent = "印刷データがありません";
    return;
  }

  document.title = data.title;

  document.getElementById("print-root").innerHTML = `
    <h1>${data.title}</h1>
    ${data.html}
  `;

  // ★ 折りたたみを強制展開
  document.querySelectorAll(".field-group > div").forEach(w => {
    w.style.display = "block";
  });

  window.print();
  window.close();
});
