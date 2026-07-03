import { loadJSON } from "/common/json.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";

const DEBUG = false;

function debugLog(...args) {
  if (DEBUG) console.log("[pesticide-list]", ...args);
}

function debugWarn(...args) {
  if (DEBUG) console.warn("[pesticide-list]", ...args);
}

export async function loadPesticideMaster() {
  debugLog("Loading pesticide master...");
  const data = await loadJSON("/data/pesticide/pesticide-index.json");
  debugLog("Master loaded:", data);
  return data;
}

export async function getPesticideByName(name) {
  const master = await loadPesticideMaster();
  return master.find(p => p.name === name) || null;
}

export async function loadAllPesticideLogs() {
  debugLog("Loading all pesticide logs...");

  const fieldsData = await loadJSON("/data/fields.json");
  const fields = fieldsData.map(f => ({
    original: f.name,
    safe: safeFieldName(f.name)
  }));

  const logs = [];

  const results = await Promise.allSettled(
    fields.map(async f => {
      const path = `/logs/pesticide/${f.safe}.json`;
      const data = await loadJSON(path);
      return { f, data };
    })
  );

  results.forEach(r => {
    if (r.status !== "fulfilled") {
      return;
    }

    const { f, data } = r.value;
    const years = data?.years && typeof data.years === "object" ? data.years : {};

    Object.keys(years).forEach(year => {
      logs.push({
        field: f.original,
        year: Number(year),
        entries: Array.isArray(years[year]?.entries) ? years[year].entries : []
      });
    });
  });

  debugLog("All logs loaded:", logs);
  return logs;
}

export function collectYears(logs) {
  const set = new Set();
  logs.forEach(l => set.add(l.year));
  return Array.from(set).sort((a, b) => b - a);
}
