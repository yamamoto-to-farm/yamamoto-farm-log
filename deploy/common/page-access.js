const USER_ROLES = ["worker", "family", "admin"];

function normalizePath(path) {
  return path.endsWith("/") ? `${path}index.html` : path;
}

export function getPageAccess(pages, target, role) {
  if (!USER_ROLES.includes(role)) return { allowed: false, page: null };
  const url = new URL(target, "https://farm.invalid/");
  const pathname = normalizePath(url.pathname);
  const matches = [];
  for (const page of pages) {
    if (!page?.path) continue;
    const pageUrl = new URL(page.path, "https://farm.invalid/");
    if (normalizePath(pageUrl.pathname) !== pathname) continue;
    const params = [...pageUrl.searchParams.entries()];
    if (!params.every(([key, value]) => url.searchParams.get(key) === value)) continue;
    matches.push({ page, specificity: params.length });
  }
  matches.sort((first, second) => second.specificity - first.specificity);
  const page = matches[0]?.page || null;
  if (page) return { allowed: Array.isArray(page.roles) && page.roles.includes(role), page };
  if (pathname.startsWith("/admin/")) return { allowed: role === "admin", page: null };
  return { allowed: false, page: null };
}

let pagesPromise;

export async function loadAccessPages() {
  if (!pagesPromise) {
    pagesPromise = fetch("/data/pages.json", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("ページ権限設定を読み込めませんでした。");
        const data = await response.json();
        if (!Array.isArray(data?.pages)) throw new Error("ページ権限設定が不正です。");
        return data.pages;
      })
      .catch(error => {
        pagesPromise = null;
        throw error;
      });
  }
  return pagesPromise;
}