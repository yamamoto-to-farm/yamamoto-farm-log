// fertilizer.js

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";

/* ============================================================
   初期化（フィルタ構造＋モーダル構造）
============================================================ */
export async function initFertilizerPage() {

  // 1. フィルタデータ初期化（fields.parents / children をセット）
  await initFieldFilterData();

  // 2. アクティブフィルタタグ UI 初期化
  initActiveFilterUI();

  // 3. 圃場モーダル（filter-field.js のモーダル構造）
  const btnField = document.getElementById("open-field-modal");
  if (btnField) {
    btnField.onclick = () => {
      openFieldModal({ mode: "filter" });
    };
  }

  // 4. フィルタ変更時の表示更新
  document.addEventListener("filter:apply", updateSelectedFields);
  document.addEventListener("filter:reset", updateSelectedFields);

  updateSelectedFields();

  // 5. 保存ボタン
  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = saveData;
  }
}

/* ============================================================
   圃場フィルタデータ初期化（fields.parents / children）
============================================================ */
async function initFieldFilterData() {
  const res = await fetch("/data/fields.json?v=" + Date.now());
  const fields = await res.json();

  const parents = [];
  const children = {};

  fields.forEach(f => {
    if (!children[f.area]) {
      children[f.area] = [];
      parents.push(f.area);
    }
    children[f.area].push(f.name);
  });

  setFilterData({
    years: [],
    months: {},
    fields: { parents, children },
    varieties: { parents: [], children: {} }
  });
}

/* ============================================================
   選択圃場の表示更新
============================================================ */
function updateSelectedFields() {
  const fields = filterState.fields || [];
  const el = document.getElementById("selected-fields");
  if (!el) return;

  el.textContent = fields.length ? fields.join("、") : "未選択";
}

/* ============================================================
   保存処理
============================================================ */
async function saveData() {
  const date = document.getElementById("date").value;
  const fields = filterState.fields || [];
  const fertilizer_id = document.getElementById("fertilizer_id").value.trim();
  const bags = Number(document.getElementById("bags").value);
  const amountValue = Number(document.getElementById("amount").value);
  const machine = document.getElementById("machine").value.trim();
  const worker = document.getElementById("worker").value.trim();
  const notes = document.getElementById("notes").value.trim();

  if (!date || fields.length === 0 || !fertilizer_id) {
    alert("日付・圃場・肥料名は必須です");
    return;
  }

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }

  try {
    await saveMultiFieldLog({
      type: "fertilizer",
      date,
      fields,
      entry: {
        fertilizer_id,
        bags,
        amount: { value: amountValue, unit: "kg" },
        machine,
        worker,
        notes
      }
    });

    alert("保存しました！");
    document.getElementById("notes").value = "";

  } catch (e) {
    console.error(e);
    alert("保存に失敗しました");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  }
}
