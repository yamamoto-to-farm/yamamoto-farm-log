function isSafeInternalPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function toInternalPath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== location.origin) return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

export function resolveBackTarget({ returnParam = "return", fallbackPath = "/" } = {}) {
  const params = new URLSearchParams(location.search);
  const fromParam = params.get(returnParam) || "";
  if (isSafeInternalPath(fromParam)) {
    return { type: "path", source: "return", path: fromParam };
  }

  const fromReferrer = toInternalPath(document.referrer || "");
  if (isSafeInternalPath(fromReferrer) && fromReferrer !== `${location.pathname}${location.search}${location.hash}`) {
    return { type: "path", source: "referrer", path: fromReferrer };
  }

  if (history.length > 1) {
    return { type: "history", source: "history" };
  }

  const safeFallback = isSafeInternalPath(fallbackPath) ? fallbackPath : "/";
  return { type: "path", source: "fallback", path: safeFallback };
}

export function setupSmartBackButton({
  elementId,
  returnParam = "return",
  fallbackPath = "/",
  logInputPath = "",
  logInputLabel = "ログ入力へ戻る",
  defaultLabel = "元のページへ戻る"
} = {}) {
  const el = document.getElementById(elementId);
  if (!el) return null;

  const target = resolveBackTarget({ returnParam, fallbackPath });
  const isLogInput = target.type === "path" && !!logInputPath && target.path === logInputPath;
  el.textContent = isLogInput ? logInputLabel : defaultLabel;

  const onClick = event => {
    event.preventDefault();

    if (target.type === "path") {
      location.href = target.path;
      return;
    }

    if (history.length > 1) {
      history.back();
      return;
    }

    const safeFallback = isSafeInternalPath(fallbackPath) ? fallbackPath : "/";
    location.href = safeFallback;
  };

  el.addEventListener("click", onClick);

  if (el.tagName === "A") {
    const href = target.type === "path"
      ? target.path
      : (isSafeInternalPath(fallbackPath) ? fallbackPath : "/");
    el.setAttribute("href", href);
  }

  return target;
}
