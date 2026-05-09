import { saveFertilizerLog } from "/common/general-log/fertilizer.js?v=1";

document.getElementById("save-btn").onclick = async () => {
  const date = document.getElementById("date").value;

  const fields = Array.from(
    document.getElementById("fields").selectedOptions
  ).map(o => o.value);

  const fertilizer_id = document.getElementById("fertilizer_id").value;
  const bags = Number(document.getElementById("bags").value);
  const amountValue = Number(document.getElementById("amount").value);
  const machine = document.getElementById("machine").value;
  const worker = document.getElementById("worker").value;
  const notes = document.getElementById("notes").value;

  if (!date || fields.length === 0 || !fertilizer_id) {
    alert("日付・圃場・肥料名は必須です");
    return;
  }

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
};
