import {
  openFieldModal,
  setFilterData,
  filterState
} from "/common/filter.js?v=1";

import { saveFertilizerLog } from "/common/general-log/fertilizer.js?v=1";

/* ============================================================
   初期化
============================================================ */
export async function initFertilizerPage() {
  await initFieldFilterData();

  /* ▼ 圃場選択モーダルを開く */
  document.getElementById("open-field-modal").onclick = () => {
    openFieldModal({
      mode: "filter"
    });
  };

  /* ▼ 圃場選択が更新されたら UI に反映 */
  document.addEventListener("filter:apply", updateSelectedFields);
  document.addEventListener("filter:reset", updateSelectedFields);
  updateSelectedFields();

  /* ▼ 保存処理 */
  document.getElementById("save-btn").onclick = async () => {
    const date = document.getElementById("date").value;
    const fields = filterState.fields;
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
    btn.disabled = true;
    btn.textContent = "保存中…";

    try {
      await saveFertilizerLog({
        date,
        fields,
        fertilizer_id,
        bags,
        amount: { value: amountValue, unit: "kg" },
        machine,
        worker,
        notes
      });

      alert("保存しました！");
      document.getElementById("notes").value = "";

    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  };
}

/* ============================================================
   圃場フィルタデータ初期化
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
    yearMonths: [],
    fields: { parents, children },
    varieties: { parents: [], children: {} }
  });
}

/* ============================================================
   選択圃場の表示更新
============================================================ */
function updateSelectedFields() {
  const fields = filterState.fields;
  document.getElementById("selected-fields").textContent =
    fields.length ? fields.join("、") : "未選択";
}
