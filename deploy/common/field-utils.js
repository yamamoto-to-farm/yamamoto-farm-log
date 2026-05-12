// /common/field-utils.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[field-utils]", ...args);
}

// ===============================
// キャッシュ（field-detail.json）
// ===============================
let fieldDetailCache = null;

/* ============================================================
   field-detail.json を読み込む（1回だけ）
============================================================ */
export async function loadFieldDetail() {
  if (fieldDetailCache) {
    return fieldDetailCache;
  }

  try {
    const res = await fetch("/data/field-detail.json?v=" + Date.now());
    fieldDetailCache = await res.json();
    debugLog("field-detail loaded", fieldDetailCache);
  } catch (e) {
    console.error("field-detail load error", e);
    fieldDetailCache = {};
  }

  return fieldDetailCache;
}

/* ============================================================
   圃場名 → 面積(size) を返す
============================================================ */
export async function getFieldSize(fieldName) {
  const detail = await loadFieldDetail();
  const size = detail[fieldName]?.size || 0;

  debugLog(`getFieldSize: ${fieldName} = ${size}`);
  return size;
}

/* ============================================================
   複数圃場の合計面積
============================================================ */
export async function getTotalFieldSize(fields) {
  const detail = await loadFieldDetail();

  const total = fields.reduce((sum, f) => {
    const size = Number(detail[f]?.size || 0);  // ★ 数値化
    return sum + size;
  }, 0);

  debugLog("getTotalFieldSize:", fields, "=", total);
  return total;  // number
}


/* ============================================================
   面積比で按分（kg → 圃場ごとの kg）
============================================================ */
export async function distributeByFieldSize(fields, totalKg) {
  const detail = await loadFieldDetail();

  const totalSize = fields.reduce((sum, f) => {
    const size = Number(detail[f]?.size || 0);  // ★ 数値化
    return sum + size;
  }, 0);

  if (totalSize === 0) {
    debugLog("distributeByFieldSize: totalSize=0 → 全て0で返す");
    return fields.map(f => ({ field: f, amount: 0 }));
  }

  const result = fields.map(f => {
    const size = Number(detail[f]?.size || 0);  // ★ 数値化
    const ratio = size / totalSize;

    // 小数第1位で丸める（現場で扱いやすい）
    const amount = Math.round(totalKg * ratio * 10) / 10;

    return { field: f, amount };
  });

  debugLog("distributeByFieldSize result:", result);
  return result;
}
