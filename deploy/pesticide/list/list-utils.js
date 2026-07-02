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

  for (const f of fields) {
    const path = `/logs/pesticide/${f.safe}.json`;

    try {
      const data = await loadJSON(path);

      for (const year of Object.keys(data.years || {})) {
        logs.push({
          field: f.original,
          year: Number(year),
          entries: data.years[year].entries || []
        });
      }
    } catch {
      debugWarn(`No log for field: ${f.original} (${f.safe})`);
    }
  }

  debugLog("All logs loaded:", logs);
  return logs;
}

export function collectYears(logs) {
  const set = new Set();
  logs.forEach(l => set.add(l.year));
  return Array.from(set).sort((a, b) => b - a);
}
