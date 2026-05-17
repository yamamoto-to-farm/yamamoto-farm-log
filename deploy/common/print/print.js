// print.js

window.addEventListener("message", (e) => {
  if (e.data?.type === "PRINT_DATA") {
    const { title, html } = e.data;

    document.title = title;
    document.getElementById("print-root").innerHTML = `
      <h1>${title}</h1>
      ${html}
    `;

    // 折りたたみ強制展開
    document.querySelectorAll(".field-group > div").forEach(w => {
      w.style.display = "block";
    });

    window.print();
    window.close();
  }
});

// ★ 親ウィンドウに「準備できた」と通知
window.opener?.postMessage("READY_FOR_PRINT_DATA", "*");
