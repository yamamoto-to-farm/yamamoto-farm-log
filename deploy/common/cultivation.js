import { loadJSON } from "/common/json.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";

const SUMMARY_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

export async function buildCultivatingFieldSet(targetFields) {
  const summaryIndex = await loadJSON("/data/summary-index.json").catch(() => ({}));

  const entries = await Promise.all(
    targetFields.map(async field => {
      const summaries = await loadLatestYearSummariesForField(summaryIndex, field.name);
      const cultivatingRefs = summaries
        .filter(summary => {
          const hasHarvest = !!summary.lifecycle?.hasHarvest || (
            !!summary.harvest?.firstDate &&
            !!summary.harvest?.lastDate &&
            summary.harvest?.count > 0
          );
          return !hasHarvest && !summary.lifecycle?.discardedFully;
        })
        .map(summary => summary.plantingRef)
        .filter(Boolean);

      return cultivatingRefs.length ? [field.name, cultivatingRefs] : null;
    })
  );

  return new Map(entries.filter(Boolean));
}

async function loadLatestYearSummariesForField(summaryIndex, fieldName) {
  const key = summaryIndex[fieldName] ? fieldName : safeFieldName(fieldName);
  const byYear = summaryIndex?.[key];
  if (!byYear || typeof byYear !== "object") return [];

  const years = Object.keys(byYear).sort();
  const latestYear = years[years.length - 1];
  const files = Array.isArray(byYear[latestYear]) ? byYear[latestYear] : [];
  if (!files.length) return [];

  const summaries = await Promise.all(files.map(async file => {
    try {
      const response = await fetch(`${SUMMARY_BASE}/logs/summary/${key}/${latestYear}/${file}?ts=${Date.now()}`);
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }));

  return summaries.filter(Boolean);
}