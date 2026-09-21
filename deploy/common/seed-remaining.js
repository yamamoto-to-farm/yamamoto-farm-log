// common/seed-remaining.js
// 播種ロット（seedRef）の残数計算を各画面で共通化するためのモジュール。
// 定植・播種一覧・播種破棄の各ページで別々の計算式を使うと数値がズレるため、ここに一本化する。

export function splitSeedRefs(value) {
  return String(value || "")
    .split(/[\/／,]/)
    .map(ref => ref.trim())
    .filter(Boolean);
}

export function calcSeedDiscardQuantity(seedRef, discardSeedRows = [], legacyNurseryRows = []) {
  const ref = String(seedRef || "").trim();
  if (!ref) return 0;

  const directDiscard = (Array.isArray(discardSeedRows) ? discardSeedRows : [])
    .filter(row => String(row?.seedRef || "").trim() === ref)
    .reduce((sum, row) => {
      let qty = Number(row.discardQuantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        const trays = Number(row.discardTrays || 0);
        const trayType = Number(row.trayType || 0);
        qty = Number.isFinite(trays) && Number.isFinite(trayType) ? trays * trayType : 0;
      }
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);

  const legacyDiscard = (Array.isArray(legacyNurseryRows) ? legacyNurseryRows : [])
    .filter(row => String(row?.seedRef || "").trim() === ref)
    .reduce((sum, row) => sum + Number(row.discard || 0), 0);

  return directDiscard + legacyDiscard;
}

// seedRef ごとの残り株数（定植日の古い順に、記載された seedRef の順で消費）
export function buildSeedRemainingMap(seedRows, plantingRows, discardSeedRows = [], nurseryRows = []) {
  const remainingByRef = new Map();
  const usedByRef = new Map();

  (Array.isArray(seedRows) ? seedRows : []).forEach(row => {
    const ref = String(row?.seedRef || "").trim();
    if (!ref) return;
    const seedCount = Number(row?.seedCount || 0);
    const discarded = calcSeedDiscardQuantity(ref, discardSeedRows, nurseryRows);
    remainingByRef.set(ref, Math.max(0, seedCount - discarded));
    usedByRef.set(ref, 0);
  });

  const chronologicalPlantings = (Array.isArray(plantingRows) ? plantingRows : [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => String(a.row?.plantDate || "").localeCompare(String(b.row?.plantDate || "")) || a.index - b.index);

  chronologicalPlantings.forEach(({ row }) => {
    let quantityToAllocate = Number(row?.quantity || 0);
    if (!Number.isFinite(quantityToAllocate) || quantityToAllocate <= 0) return;

    splitSeedRefs(row?.seedRef).forEach(ref => {
      if (quantityToAllocate <= 0 || !remainingByRef.has(ref)) return;
      const available = remainingByRef.get(ref) || 0;
      const allocated = Math.min(available, quantityToAllocate);
      remainingByRef.set(ref, available - allocated);
      usedByRef.set(ref, (usedByRef.get(ref) || 0) + allocated);
      quantityToAllocate -= allocated;
    });
  });

  return { remainingByRef, usedByRef };
}
