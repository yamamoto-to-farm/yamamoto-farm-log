// =========================================================
// common/general-log/base.js
// 圃場ログの汎用保存エンジン（saveLog 版）
// =========================================================

import { loadJSON } from "/common/json.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName, safeFileName } from "/common/utils.js?v=1";

/* ---------------------------------------------------------
   1. JSON 読み込み（存在しない場合は空データを返す）
--------------------------------------------------------- */
export async function loadFieldLog(type, fieldName) {
  const path = `/logs/${type}/${fieldName}.json`;

  try {
    return await loadJSON(path);
  } catch (e) {
    // 初回はファイルが存在しないので空で返す
    return {
      field: fieldName,
      years: {}
    };
  }
}

/* ---------------------------------------------------------
   2. 年次階層の確保
--------------------------------------------------------- */
function ensureYear(data, year) {
  if (!data.years[year]) {
    data.years[year] = { entries: [] };
  }
}

/* ---------------------------------------------------------
   3. インデックス読み込み（存在しない場合は空）
--------------------------------------------------------- */
async function loadIndex(type) {
  const path = `/data/${type}-index.json`;

  try {
    return await loadJSON(path);
  } catch (e) {
    return {};
  }
}

/* ---------------------------------------------------------
   4. インデックス更新（saveLog で保存）
--------------------------------------------------------- */
async function updateIndex(type, field, year, fileName) {
  const index = await loadIndex(type);

  if (!index[field]) index[field] = {};
  if (!index[field][year]) index[field][year] = [];

  if (!index[field][year].includes(fileName)) {
    index[field][year].push(fileName);
    index[field][year].sort();
  }

  // ★ saveLog で S3 に保存（CloudFront 経由しない）
  await saveLog({
    type: "multi",
    files: [
      {
        path: `data/${type}-index.json`,
        content: JSON.stringify(index, null, 2)
      }
    ]
  });
}

/* ---------------------------------------------------------
   5. 複数圃場への按分保存（メイン処理）
--------------------------------------------------------- */
export async function saveMultiFieldLog({
  type,      // fertilizer / pesticide / water など
  date,      // "2026-05-10"
  fields,    // ["ぎょうざ東1", "ぎょうざ東2"]
  entry      // { fertilizer_id, amount:{value,unit}, bags, ... }
}) {
  const year = date.substring(0, 4);
  const fieldCount = fields.length;

  // 按分用に entry をコピー
  const dividedEntry = JSON.parse(JSON.stringify(entry));

  // amount の按分
  if (dividedEntry.amount && typeof dividedEntry.amount.value === "number") {
    dividedEntry.amount.value = dividedEntry.amount.value / fieldCount;
  }

  // bags の按分
  if (typeof dividedEntry.bags === "number") {
    dividedEntry.bags = dividedEntry.bags / fieldCount;
  }

  // 圃場ごとに保存
  for (const field of fields) {
    const safeField = safeFieldName(field);
    const filePath = `logs/${type}/${safeField}.json`; // ★ 先頭の / を付けない（saveLog 用）

    // JSON 読み込み（なければ空）
    const data = await loadFieldLog(type, safeField);

    // 年次階層を確保
    ensureYear(data, year);

    // entries に追加
    data.years[year].entries.push({
      date,
      ...dividedEntry
    });

    // ★ saveLog で S3 に保存（CloudFront を通さない）
    await saveLog({
      type: "multi",
      files: [
        {
          path: filePath,
          content: JSON.stringify(data, null, 2)
        }
      ]
    });

    // インデックス更新
    const fileName = `${date}-${safeFileName(type)}.json`;
    await updateIndex(type, safeField, year, fileName);
  }
}
