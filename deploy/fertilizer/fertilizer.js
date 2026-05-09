import { saveFertilizerLog } from "/common/general-log/fertilizer.js?v=1";

document.getElementById("save-btn").onclick = async () => {
  console.log("=== [UI] 保存ボタン押下 ===");

  const date = document.getElementById("date").value;

  const fields = Array.from(
    document.getElementById("fields").selectedOptions
  ).map(o => o.value);

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

  // ★ 必須チェック
  if (!date || fields.length === 0 || !fertilizer_id) {
    alert("日付・圃場・肥料名は必須です");
    return;
  }

  // ★ 保存実行
  try {
    console.log("=== [UI] saveFertilizerLog 呼び出し ===");

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

    console.log("=== [UI] saveFertilizerLog 完了 ===");
    alert("保存しました！");
  } catch (e) {
    console.error("=== [UI] 保存エラー発生 ===");
    console.error(e);

    alert("保存に失敗しました。コンソールログを確認してください。");
  }
};
