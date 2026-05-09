import { saveFertilizerLog } from "/common/general-log/fertilizer.js?v=1";

document.getElementById("save-btn").onclick = async () => {
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

  // ★ 必須チェック
  if (!date || fields.length === 0 || !fertilizer_id) {
    alert("日付・圃場・肥料名は必須です");
    return;
  }

  // ★ 保存実行
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
  } catch (e) {
    console.error("保存エラー:", e);
    alert("保存に失敗しました。ネットワーク状況を確認してください。");
  }
};
