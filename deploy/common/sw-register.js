(() => {
  if (!("serviceWorker" in navigator)) return;

  const BUILD = "20260820-1";
  const BUILD_KEY = "yamamotoFarmBuildVersion";

  const showUpdateNotice = (reload) => {
    if (document.getElementById("swUpdateNotice")) return;
    const box = document.createElement("div");
    box.id = "swUpdateNotice";
    box.style.position = "fixed";
    box.style.left = "12px";
    box.style.right = "12px";
    box.style.bottom = "12px";
    box.style.zIndex = "10000";
    box.style.background = "#1f2937";
    box.style.color = "#fff";
    box.style.padding = "12px";
    box.style.borderRadius = "8px";
    box.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
    box.innerHTML = `<div style="display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
      <span>更新があります。最新版を読み込みますか？</span>
      <button type="button" id="swUpdateReloadBtn" style="padding:8px 12px; border:0; border-radius:6px; background:#fff; color:#111;">再読み込み</button>
    </div>`;
    document.body.appendChild(box);
    document.getElementById("swUpdateReloadBtn")?.addEventListener("click", reload);
  };

  const ensureSingleReloadOnBuildChange = () => {
    const previous = localStorage.getItem(BUILD_KEY);
    if (previous === BUILD) return;

    localStorage.setItem(BUILD_KEY, BUILD);

    const reload = () => {
      sessionStorage.setItem("yamamotoFarmBuildReloaded", BUILD);
      window.location.reload();
    };

    if (sessionStorage.getItem("yamamotoFarmBuildReloaded") === BUILD) return;

    if (navigator.serviceWorker.controller) {
      showUpdateNotice(reload);
      return;
    }

    navigator.serviceWorker.addEventListener("controllerchange", () => showUpdateNotice(reload), { once: true });
  };

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`/sw.js?build=${BUILD}`, { scope: "/" })
      .then((registration) => registration.update())
      .then(() => {
        ensureSingleReloadOnBuildChange();
      })
      .catch((error) => {
        console.warn("Service Worker registration failed", error);
      });
  });
})();
