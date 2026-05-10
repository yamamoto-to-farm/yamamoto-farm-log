import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData } from "/common/filter/filter-core.js?v=1";
import { saveFertilizerLog } from "/common/general-log/fertilizer.js?v=1";

let selectedFields = [];

/* ============================================================
   初期化
============================================================ */
export async function initFertilizerPage() {
  await initFieldFilterData();

  document.getElementById("open-field-modal").onclick = () => {
    openFieldModal({
      mode: "select",
      onSelect: (name) => {
        toggleField(name);
        updateSelectedFields();
      }
    });
  };

  updateSelectedFields();

  document.getElementById("save-btn").onclick = saveData;
}

/* ============================================================
   圃場フィルタデータ初期化（map.js と同じ）
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
   圃場選択管理（map.js と同じ思想）
============================================================ */
function toggleField(name) {
  if (selectedFields.includes(name)) {
    selectedFields = selectedFields.filter(f => f !== name);
  } else {
    selectedFields.push(name);
  }
}

function updateSelectedFields() {
  document.getElementById("selected-fields").textContent =
    selectedFields.length ? selectedFields.join("、") : "未選択";
}

/* ============================================================
   保存処理
============================================================ */
async function saveData() {
  const date = document.getElementById("date").value;
  const fertilizer_id = document.getElementById("fertilizer_id").value.trim();
  const bags = Number(document.getElementById("bags").value);
  const amountValue = Number(document.getElementById("amount").value);
  const machine = document.getElementById("machine").value.trim();
  const worker = document.getElementById("worker").value.trim();
  const notes = document.getElementById("notes").value.trim();

  if (!date || selectedFields.length === 0 || !fertilizer_id) {
    alert("日付・圃場・肥料名は必須です");
    return;
  }

  const btn = document.getElementById("save-btn");
  btn.disabled = true;
  btn.textContent = "保存中…";

  try {
    await saveFertilizerLog({
      date,
      fields: selectedFields,
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
}
