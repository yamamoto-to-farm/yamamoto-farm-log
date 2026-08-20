// admin/edit-csv/saver.js
import { saveLog } from "../../common/save/index.js";
import { enqueueSummaryUpdate } from "../../common/summary.js?v=20260820";
import { parseCsvText } from "/common/csv.js?v=20260820";

// ★ 共通保存モーダル
import { showSaveModal, updateSaveModal, completeSaveModal } from "../../common/save-modal.js";

/* ---------------------------------------------------------
   デバッグ切り替え（localStorage）
--------------------------------------------------------- */
function isDebug() {
  return localStorage.getItem("debugEditCsv") === "1";
  // localStorage.setItem("debugEditCsv", "1");  // ON
  // localStorage.removeItem("debugEditCsv");    // OFF
}

function dbg(...args) {
  if (isDebug()) console.log("[edit-csv]", ...args);
}

function cloneRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({ ...row }));
}

function normalizeValue(value) {
  return String(value ?? "").trim();
}

function getOriginalRows(csvType, csvFile) {
  if (window._editCsvOriginalType !== csvType || window._editCsvOriginalFile !== csvFile) {
    return [];
  }
  return cloneRows(window._editCsvOriginalRows || []);
}

function getRequiredHeaders(csvType) {
  const map = {
    planting: ["plantDate", "worker", "field", "variety", "seedRef", "quantity", "trayType", "spacingRow", "spacingBed", "harvestPlanYM", "plantingRef"],
    harvest: ["harvestDate", "shippingDate", "worker", "field", "amount", "plantingRef"],
    weight: ["shippingDate", "field", "bins", "totalWeight", "plantingRef"],
    seed: ["seedRef", "seedDate", "varietyName", "trayType", "trayCount", "seedCount", "source"]
  };
  return map[csvType] || [];
}

function getDateHeaders(headers) {
  return headers.filter(h => /date$/i.test(h) || ["plantDate", "harvestDate", "shippingDate", "seedDate"].includes(h));
}

function getNumberHeaders(headers) {
  const numberNames = new Set([
    "quantity", "trayType", "spacingRow", "spacingBed", "amount", "bins", "totalWeight",
    "trayCount", "seedCount", "remainingCount", "discardTrays", "discardQuantity"
  ]);
  return headers.filter(h => numberNames.has(h));
}

function validateCsvStructure(csvType, headers, rows) {
  const errors = [];
  const trimmedHeaders = headers.map(h => normalizeValue(h));
  const emptyHeaders = trimmedHeaders.filter(h => !h);
  if (emptyHeaders.length > 0) errors.push("空の列名があります");

  const duplicates = trimmedHeaders.filter((h, i) => h && trimmedHeaders.indexOf(h) !== i);
  if (duplicates.length > 0) errors.push(`重複した列名があります: ${[...new Set(duplicates)].join(" / ")}`);

  const required = getRequiredHeaders(csvType);
  const missing = required.filter(h => !trimmedHeaders.includes(h));
  if (missing.length > 0) errors.push(`必須列がありません: ${missing.join(" / ")}`);

  const dateHeaders = getDateHeaders(trimmedHeaders);
  const numberHeaders = getNumberHeaders(trimmedHeaders);

  rows.forEach((row, index) => {
    trimmedHeaders.forEach(h => {
      const value = normalizeValue(row[h]);
      if (/\r|\n/.test(value)) errors.push(`${index + 1}行目 ${h}: 改行が含まれています`);
    });

    dateHeaders.forEach(h => {
      const value = normalizeValue(row[h]);
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push(`${index + 1}行目 ${h}: 日付は YYYY-MM-DD 形式にしてください`);
      }
    });

    numberHeaders.forEach(h => {
      const value = normalizeValue(row[h]);
      if (value && !Number.isFinite(Number(value))) {
        errors.push(`${index + 1}行目 ${h}: 数値を入力してください`);
      }
    });
  });

  return errors;
}

function collectChanges(headers, originalRows, currentRows) {
  const changes = [];
  const max = Math.max(originalRows.length, currentRows.length);

  for (let i = 0; i < max; i += 1) {
    const before = originalRows[i] || null;
    const after = currentRows[i] || null;

    if (!before && after) {
      changes.push({ type: "added", row: i + 1, after });
      continue;
    }
    if (before && !after) {
      changes.push({ type: "deleted", row: i + 1, before });
      continue;
    }
    if (!before || !after) continue;

    headers.forEach(header => {
      const oldValue = normalizeValue(before[header]);
      const newValue = normalizeValue(after[header]);
      if (oldValue !== newValue) {
        changes.push({ type: "cell", row: i + 1, header, before: oldValue, after: newValue, beforeRow: before, afterRow: after });
      }
    });
  }

  return changes;
}

function summarizeChange(change) {
  if (change.type === "added") return `${change.row}行目: 追加`;
  if (change.type === "deleted") return `${change.row}行目: 削除`;
  return `${change.row}行目 ${change.header}: ${change.before || "(空)"} → ${change.after || "(空)"}`;
}

function confirmChanges(changes) {
  if (changes.length === 0) {
    alert("変更がありません");
    return false;
  }

  const preview = changes.slice(0, 25).map(summarizeChange);
  const omitted = changes.length > preview.length
    ? `\nほか ${changes.length - preview.length} 件`
    : "";

  return confirm([
    `変更 ${changes.length} 件を保存します。`,
    "",
    ...preview,
    omitted,
    "",
    "保存前バックアップを作成してから保存します。よろしいですか？"
  ].filter(Boolean).join("\n"));
}

function getSummaryTargets(csvType, changes) {
  if (!["planting", "harvest", "weight"].includes(csvType)) return [];
  if (csvType === "planting" && changes.some(c =>
    c.type === "deleted" ||
    (c.type === "cell" && ["plantingRef", "field", "plantDate"].includes(c.header))
  )) {
    return ["*"];
  }

  const refs = new Set();
  changes.forEach(change => {
    if (change.type === "added") {
      const ref = normalizeValue(change.after?.plantingRef);
      if (ref) refs.add(ref);
      return;
    }
    if (change.type === "deleted") {
      const ref = normalizeValue(change.before?.plantingRef);
      if (ref) refs.add(ref);
      return;
    }

    const beforeRef = normalizeValue(change.beforeRow?.plantingRef);
    const afterRef = normalizeValue(change.afterRow?.plantingRef);
    if (beforeRef) refs.add(beforeRef);
    if (afterRef) refs.add(afterRef);
  });

  return [...refs];
}

function makeBackupPath(csvType, csvFile) {
  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "-",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0")
  ].join("");
  const safeFile = String(csvFile || "all.csv").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `logs/${csvType}/backup/${stamp}-${safeFile}`;
}

function normalizeBackupPath(csvType, rawPath) {
  const text = String(rawPath || "").trim();
  if (!text) return "";
  if (text.startsWith("http://") || text.startsWith("https://")) {
    return new URL(text).pathname.replace(/^\//, "");
  }
  if (text.startsWith("logs/")) return text;
  return `logs/${csvType}/backup/${text}`;
}

async function fetchBackupCsv(path) {
  const url = `https://d3sscxnlo0qnhe.cloudfront.net/${path}?ts=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`バックアップCSVを取得できませんでした: ${res.status}`);
  return await res.text();
}

export async function restoreCsvFromBackup(csvType, csvFile) {
  const backupPath = normalizeBackupPath(csvType, prompt([
    "復元するバックアップパス、またはバックアップファイル名を入力してください。",
    `例: logs/${csvType}/backup/20260820-153012-${csvFile}`,
    `例: 20260820-153012-${csvFile}`
  ].join("\n")));
  if (!backupPath) return;

  if (!confirm(`${backupPath}\n\nこのバックアップで logs/${csvType}/${csvFile} を上書き復元します。よろしいですか？`)) return;

  try {
    showSaveModal("バックアップを読み込んでいます…");
    const csvText = await fetchBackupCsv(backupPath);
    const rows = parseCsvText(csvText);
    if (!rows.length) throw new Error("バックアップCSVが空です");

    updateSaveModal("CSV を復元しています…");
    await saveLog({
      type: csvType,
      replaceCsv: csvText,
      fileName: csvFile,
      suppressModal: true
    });

    completeSaveModal("バックアップから復元しました");
  } catch (e) {
    console.error("restoreCsvFromBackup failed:", e);
    updateSaveModal(`復元に失敗しました: ${String(e?.message || e)}`);
  }
}

/* ---------------------------------------------------------
   CSV 保存処理
--------------------------------------------------------- */
export async function saveCsvFile(csvType, csvFile) {
  dbg("=== saveCsvFile START ===");
  dbg("csvType:", csvType, "csvFile:", csvFile);

  const table = document.querySelector("#csvTableArea table");
  if (!table) {
    console.error("❌ テーブルが見つかりません");
    updateSaveModal("テーブルがありません");
    return;
  }
  dbg("✔ table found:", table);

  // ------------------------------
  // 1. ヘッダー取得
  // ------------------------------
  const headerCells = table.querySelectorAll("thead th");
  const headers = Array.from(headerCells)
    .slice(1) // 先頭の "#" を除く
    .map(th => th.textContent.trim());

  dbg("✔ headers:", headers);

  if (headers.length === 0) {
    updateSaveModal("列情報が取得できないため保存を中止しました");
    return;
  }

  // ------------------------------
  // 2. 行データ取得
  // ------------------------------
  const rows = [];
  const trList = table.querySelectorAll("tbody tr");

  dbg("✔ tr count:", trList.length);

  if (trList.length === 0) {
    updateSaveModal("行が0件のため保存を中止しました（全消去防止）");
    return;
  }

  trList.forEach((tr, rowIndex) => {
    const cells = tr.querySelectorAll("td");
    const obj = {};

    headers.forEach((h, i) => {
      obj[h] = (cells[i + 1].textContent || "").trim();
    });

    dbg(`row ${rowIndex}:`, obj);
    rows.push(obj);
  });

  // ------------------------------
  // 3. CSV 文字列に変換
  // ------------------------------
  const csvText = Papa.unparse(rows, {
    columns: headers,
    skipEmptyLines: true
  });

  const originalRows = getOriginalRows(csvType, csvFile);
  const validationErrors = validateCsvStructure(csvType, headers, rows);
  if (validationErrors.length > 0) {
    alert([
      "CSV の構造に問題があるため保存を中止しました。",
      "",
      ...validationErrors.slice(0, 30),
      validationErrors.length > 30 ? `ほか ${validationErrors.length - 30} 件` : ""
    ].filter(Boolean).join("\n"));
    updateSaveModal("CSV の構造エラーで保存を中止しました");
    return;
  }

  const changes = collectChanges(headers, originalRows, rows);
  if (!confirmChanges(changes)) return;

  const originalCsvText = Papa.unparse(originalRows, {
    columns: headers,
    skipEmptyLines: true
  });
  const summaryTargets = getSummaryTargets(csvType, changes);

  dbg("=== FINAL CSV TEXT (Papa.unparse) ===\n" + csvText);

  // ==========================================================
  // ★ 4. saveLog → S3 保存（後方互換100%）
  // ==========================================================
  try {
    showSaveModal("保存前バックアップを作成しています…");
    updateSaveModal("保存前バックアップを作成しています…");
    await saveLog({
      type: "multi",
      files: [
        {
          path: makeBackupPath(csvType, csvFile),
          content: originalCsvText
        }
      ],
      suppressModal: true
    });

    updateSaveModal("CSV を保存しています…");
    await saveLog({
      type: csvType,
      dateStr: "all",
      json: null,
      csv: "",
      replaceCsv: csvText,
      fileName: csvFile,
      suppressModal: true
    });

    // CloudFront の URL（loader.js と統一）
    const url = `https://d3sscxnlo0qnhe.cloudfront.net/logs/${csvType}/${csvFile}`;

    // 保存した内容をローカルキャッシュに即反映
    window._csvCache = window._csvCache || {};
    window._csvCache[url] = rows;

    // ------------------------------
    // 5. サマリー更新（本丸）
    // ------------------------------
    dbg("=== summary update START ===");

    if (csvType === "planting" || csvType === "harvest" || csvType === "weight") {
      if (summaryTargets.length > 0) {
        updateSaveModal("CSV の保存が完了しました。サマリー更新を待っています…");
        summaryTargets.forEach(ref => enqueueSummaryUpdate(ref));
        dbg("summary target:", summaryTargets);
      } else {
        completeSaveModal("CSV の保存が完了しました（サマリー対象なし）");
      }
    } else {
      completeSaveModal("CSV の保存が完了しました");
    }

    dbg("=== summary update ENQUEUED ===");

  } catch (e) {
    console.error("❌ saveLog error:", e);
    updateSaveModal("保存に失敗しました（Console を確認してください）");
  }

  dbg("=== saveCsvFile END ===");
}
