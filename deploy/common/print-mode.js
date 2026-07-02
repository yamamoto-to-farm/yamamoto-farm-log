import { printCurrentPage } from "/common/utils.js";

(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has("print")) return;

  const run = async () => {
    try {
      await printCurrentPage(document.title || "印刷");
    } catch (e) {
      console.error("print-mode failed", e);
      window.print();
    }
  };

  if (document.readyState === "complete") {
    run();
    return;
  }

  window.addEventListener("load", () => {
    setTimeout(run, 300);
  }, { once: true });
})();