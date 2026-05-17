// /common/print/print.js

window.addEventListener("message", (e) => {
  if (e.data?.type === "PRINT_DATA") {
    const { title, html } = e.data;

    document.title = title;

    const root = document.getElementById("print-root");
    root.innerHTML = `
      <h1>${title}</h1>
      ${html}
    `;

    // ★ 折りたたみ強制展開
    document.querySelectorAll(".field-group > div").forEach(w => {
      w.style.display = "block";
    });

    // ★ レイアウト確定を待つ（これが超重要）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          window.print();
          window.close();
        }, 50);
      });
    });
  }
});

// ★ 親ウィンドウに「準備できた」と通知
window.opener?.postMessage("READY_FOR_PRINT_DATA", "*");
