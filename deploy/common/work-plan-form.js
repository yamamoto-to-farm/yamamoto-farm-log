export async function loadFamilyWorkers() {
  const response = await fetch("/data/workers.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`担当者を取得できません（${response.status}）。`);
  const workers = await response.json();
  if (!Array.isArray(workers)) throw new Error("担当者データの形式が不正です。");
  return [...new Set(workers.filter(worker => ["admin", "family"].includes(worker.role))
    .map(worker => String(worker.display || "").trim()).filter(Boolean))];
}
