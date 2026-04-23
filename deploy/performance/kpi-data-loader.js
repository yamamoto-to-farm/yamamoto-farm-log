// kpi-data-loader.js
// summary-index / year-index / CSV 読み込み

import { loadJSON } from "/common/json.js?v=1.1";
import { loadCSV } from "/common/csv.js?v=1.1";

export const loadSummaryIndex = () =>
  loadJSON("/data/summary-index.json");

export const loadYearIndex = () =>
  loadJSON("/data/year-index.json");

export const loadPlantingCSV = () =>
  loadCSV("/logs/planting/all.csv");

export const loadWeightCSV = () =>
  loadCSV("/logs/weight/all.csv");

export const loadSummaryJSON = (path) =>
  loadJSON(path);
