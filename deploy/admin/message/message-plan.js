export function planRecipients(plan) {
  return plan.recipients || (plan.source === "message" ? plan.names : []);
}

export function communicationIssues(plan) {
  const recipients = planRecipients(plan);
  const participants = new Set([...plan.names, ...plan.blocks.flatMap(block => block.companions || [])]);
  const issues = [];
  if (!recipients.length) issues.push("連絡するパートを予定編集で選択してください。");
  if (recipients.some(name => !participants.has(name))) issues.push("連絡先が作業者に含まれていません。");
  if (!plan.off) {
    if (!plan.blocks.length || plan.blocks.some(block => !block.start || !block.end)) issues.push("連絡には開始・終了時刻が必要です。");
    if (plan.blocks.some(block => !block.shed && !(block.fields?.length || block.field))) issues.push("圃場または作業場集合を指定してください。");
    if (plan.kind === "2" && !recipients.includes(plan.reporter)) issues.push("パートのみの作業は連絡係を指定してください。");
  }
  return issues;
}

export function buildPlanMessage(plan, date) {
  const today = new Date();
  const local = offset => {
    const day = new Date(today);
    day.setDate(day.getDate() + offset);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };
  const parsed = new Date(`${date}T00:00:00`);
  const label = date === local(0) ? "今日" : date === local(1) ? "明日"
    : `${parsed.getMonth() + 1}/${parsed.getDate()}（${"日月火水木金土"[parsed.getDay()]}）`;
  const lines = ["お疲れさまです。"];
  if (plan.off) {
    lines.push(`${label}の作業ですが、${plan.off_reason || "作業の都合により"}、お休みとさせて下さい。`, "");
  } else {
    lines.push(`${label}の作業予定です。`, "");
    for (const block of plan.blocks) {
      lines.push(`■ ${block.start && block.end ? `${block.start.replace(/^0/, "")}〜${block.end.replace(/^0/, "")}` : "時間未指定"}`);
      if (block.shed) lines.push("・作業場集合");
      const fields = block.fields || (block.field ? [block.field] : []);
      if (fields.length) lines.push(`・畑「${fields.join("・")}」`);
      lines.push(`・作業：${block.task}`, "");
    }
    if (plan.kind === "2") {
      lines.push("パートさんのみでの作業です。", `連絡係は${plan.reporter}さんにお願いします。`,
        "作業の開始・終了時（昼をまたぐ日は休憩の前後も）に、写真つきのLINE報告をお願いします。", "");
    } else if (plan.kind === "3") {
      lines.push("1人での作業になります。",
        "作業の開始・終了時（昼をまたぐ日は休憩の前後も）に、写真つきのLINE報告をお願いします。",
        "安全に気をつけて作業をお願いします。", "");
    }
  }
  if (plan.memo) lines.push(plan.memo, "");
  lines.push("よろしくお願いします。");
  return lines.join("\n");
}

export async function recordPlanCopy(date, id, plan, message, get, write) {
  const current = await get(date);
  if (!Object.hasOwn(current, "revision") || (current.revision !== null && typeof current.revision !== "string")) {
    throw new Error("予定の保存状態を確認できませんでした。");
  }
  const latest = current.data.plans?.[id];
  if (!latest || latest.updated_at !== plan.updated_at) {
    throw new Error("予定が変更・削除されています。再読み込みして連絡内容を確認してください。");
  }
  const result = await write({
    date, revision: current.revision, id, operation: "communicate",
    plan_revision: plan.updated_at, recipients: planRecipients(plan), message,
  });
  if (result.saved !== true || result.date !== date) throw new Error("コピー記録の保存完了を確認できませんでした。");
  return result;
}
