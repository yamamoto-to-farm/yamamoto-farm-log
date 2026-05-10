import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { saveFertilizerLog } from "/common/general-log/fertilizer.js?v=1";

/* ============================================================
   初期化
============================================================ */
export function initFertilizerPage() {

  /* ▼ 圃場選択モーダルを開く */
  document.getElementById("open-field-modal").onclick = () => {
    openFieldModal({
      mode: "filter"   // ★複数選択モード
    });
  };

  /* ▼ 圃場選択が更新されたら UI に反映 */
  document.addEventListener("filter-updated", () => {
    const fields = window.filterState.fields;
    document.getElementById("selected-fields").textContent =
      fields.length ? fields.join("、") : "未選択";
  });

  /* ▼ 保存処理 */
  document.getElementById("save-btn").onclick = async () => {
    console.log("=== [UI] 保存ボタン押下 ===");

    const date = document.getElementById("date").value;
    const fields = window.filterState.fields;
    const fertilizer_id = document.getElementById("fertilizer_id").value.trim();
    const bags = Number(document.getElementById("bags").value);
    const amountValue = Number(document.getElementById("amount").value);
    const machine = document.getElementById("machine").value.trim();
    const worker = document.getElementById("worker").value.trim();
    const notes = document.getElementById("notes").value.trim();

    console.log("[UI] 入力値:", {
      date,
      fields,
      fertilizer_id,
      bags,
      amountValue,
      machine,
      worker,
      notes
    });

    // 必須チェック
    if (!date || fields.length === 0 || !fertilizer_id) {
      alert("日付・圃場・肥料名は必須です");
      return;
    }

    // 保存ボタン連打防止
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
