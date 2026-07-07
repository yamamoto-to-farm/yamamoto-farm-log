import { loadJSON } from "/common/json.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";

const DEBUG = false;
function debugLog(...args) {
  if (DEBUG) console.log("[weeding-list]", ...args);
}

export async function loadAllWeedingLogs() {
  const fieldsData = await loadJSON("/data/fields.json");
  const fields = fieldsData.map(f => ({
    original: f.name,
    safe: safeFieldName(f.name)
  }));

  const merged = new Map();

  const results = await Promise.allSettled(fields.map(async f => {
    const path = `/logs/weeding/${f.safe}.json`;
    try {
      const data = await loadJSON(path);
      return { field: f, data };
    } catch {
      return null;
    }
  }));

  results.forEach(result => {
    if (result.status !== "fulfilled" || !result.value) return;
    const { field: f, data } = result.value;
    if (!data || !data.years) return;

    Object.keys(data.years).forEach(year => {
      const entries = data.years[year]?.entries || [];

      entries.forEach((entry, idx) => {
        const date = String(entry.date || "");
        const workType = String(entry.workType || "");
        const workers = normalizeWorkers(entry.workers || entry.worker || "");
        const machine = String(entry.machine || "");
        const mowingMethod = String(entry.mowingMethod || "");
        const notes = String(entry.notes || "");
        const pesticides = normalizePesticides(entry.pesticides || []);

        const key = [date, workType, workers, machine, mowingMethod, notes, pesticides].join("||") + `||${idx}`;

        if (!merged.has(key)) {
          merged.set(key, {
            year: Number(year),
            date,
            workType,
            workers,
            machine,
            mowingMethod,
            notes,
            pesticides,
            fields: new Set([f.original])
          });
        } else {
          merged.get(key).fields.add(f.original);
        }
      });
    });
  });

  const list = Array.from(merged.values()).map(v => ({
    ...v,
    fieldText: Array.from(v.fields).sort().join("／")
  }));

  list.sort((a, b) => {
    const d = String(b.date).localeCompare(String(a.date));
    if (d !== 0) return d;
    return String(a.workType).localeCompare(String(b.workType));
  });

  debugLog("loaded logs", list.length);
  return list;
}

export function collectYears(items) {
  const set = new Set();
  items.forEach(i => {
    if (i.year) set.add(i.year);
  });
  return Array.from(set).sort((a, b) => b - a);
}

function normalizeWorkers(value) {
  if (Array.isArray(value)) {
    return value
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("／");
  }
  return String(value || "").trim();
}

function normalizePesticides(value) {
  if (!Array.isArray(value)) return "";
  return value.map(v => String(v || "").trim()).filter(Boolean).join("／");
}
