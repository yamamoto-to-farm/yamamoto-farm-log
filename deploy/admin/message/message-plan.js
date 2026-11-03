export function createMessagePlan(card, message) {
  const names = card.names.map(person => String(person.name || "").trim());
  if (!names.length || names.some(name => !name) || new Set(names).size !== names.length) {
    throw new Error("担当者を重複なく指定してください。");
  }
  const blocks = card.off ? [] : card.blocks.map(block => ({
    start: block.start, end: block.end,
    field: block.field.trim(), task: block.task.trim(), shed: Boolean(block.shed),
  }));
  if (!card.off && (!blocks.length || blocks.some(block =>
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(block.start)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(block.end)
    || block.start >= block.end || !block.task))) {
    throw new Error("作業内容と開始・終了時刻を入力してください（終了は開始より後）。");
  }
  return {
    names, blocks, off: Boolean(card.off), off_reason: card.offReason || "",
    kind: card.kind, reporter: card.reporter || "", memo: card.memo,
    message, manual_text: card.manualText != null,
  };
}

export async function persistMessagePlan(date, plan, get, post) {
  const current = await get("/shift/work-plans", { date });
  if (current.date !== date || !Object.hasOwn(current, "revision")
      || (current.revision !== null && typeof current.revision !== "string")) {
    throw new Error("予定の保存状態を確認できませんでした。");
  }
  const result = await post("/shift/work-plans", { date, revision: current.revision, plan });
  if (result.saved !== true || result.date !== date) {
    throw new Error("予定の保存完了を確認できませんでした。");
  }
  return result;
}
