(() => {
  if (!("serviceWorker" in navigator)) return;

  const BUILD = "20260713-1";
  const BUILD_KEY = "yamamotoFarmBuildVersion";

  const ensureSingleReloadOnBuildChange = () => {
    const previous = localStorage.getItem(BUILD_KEY);
    if (previous === BUILD) return;

    localStorage.setItem(BUILD_KEY, BUILD);

    if (sessionStorage.getItem("yamamotoFarmBuildReloaded") === BUILD) return;
    sessionStorage.setItem("yamamotoFarmBuildReloaded", BUILD);

    const reload = () => {
      window.location.reload();
    };

    if (navigator.serviceWorker.controller) {
      reload();
      return;
    }

    navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
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
