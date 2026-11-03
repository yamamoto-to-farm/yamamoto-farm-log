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

export function buildPlanMessage(plan, date, envelope = true) {
  const today = new Date();
  const local = offset => {
    const day = new Date(today);
    day.setDate(day.getDate() + offset);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };
  const parsed = new Date(`${date}T00:00:00`);
  const label = date === local(0) ? "今日" : date === local(1) ? "明日"
    : `${parsed.getMonth() + 1}/${parsed.getDate()}（${"日月火水木金土"[parsed.getDay()]}）`;
  const lines = envelope ? ["お疲れさまです。"] : [];
  if (plan.off) {
    lines.push(envelope ? `${label}の作業ですが、${plan.off_reason || "作業の都合により"}、お休みとさせて下さい。`
      : `■ 中止：${plan.blocks.map(block => `${block.start && block.end ? `${block.start}〜${block.end} ` : ""}${block.task}`).join("・") || "作業"}\n${plan.off_reason || "作業の都合により"}、この作業は中止です。`, "");
  } else {
    if (envelope) lines.push(`${label}の作業予定です。`, "");
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
  if (envelope) lines.push("よろしくお願いします。");
  return lines.join("\n");
}

export function messageGroups(plans) {
  const idsByPerson = new Map();
  for (const id of Object.keys(plans).sort()) {
    for (const name of planRecipients(plans[id])) {
      if (!idsByPerson.has(name)) idsByPerson.set(name, []);
      idsByPerson.get(name).push(id);
    }
  }
  const groups = new Map();
  for (const [name, ids] of idsByPerson) {
    const key = JSON.stringify(ids);
    if (!groups.has(key)) groups.set(key, { ids, recipients: [] });
    groups.get(key).recipients.push(name);
  }
  return [...groups.values()].map(group => {
    group.recipients.sort();
    const entries = group.ids.map(id => ({ id, plan: plans[id] })).sort((a, b) =>
      (a.plan.blocks[0]?.start || "99:99").localeCompare(b.plan.blocks[0]?.start || "99:99") || a.id.localeCompare(b.id));
    const id = group.ids.length === 1 && group.recipients.length === planRecipients(entries[0].plan).length
      ? group.ids[0] : JSON.stringify([group.ids, group.recipients]);
    return { ...group, entries, id };
  });
}
export function buildGroupMessage(group, date) {
  if (group.entries.length === 1) return buildPlanMessage(group.entries[0].plan, date);
  return ["お疲れさまです。", `${date}の作業予定です。`, "",
    ...group.entries.map(({ plan }) => buildPlanMessage(plan, date, false)), "よろしくお願いします。"].join("\n");
}
export function checkMessageGroup(group, plans) {
  const current = messageGroups(plans).find(item => item.id === group.id);
  if (!current || current.entries.some(({ id, plan }) =>
    group.entries.find(item => item.id === id)?.plan.updated_at !== plan.updated_at)) {
    throw new Error("予定が変更・削除されています。再読み込みして連絡内容を確認してください。");
  }
}
export function groupCommunicationState(group, communications) {
  const recipientKey = JSON.stringify(group.recipients);
  const relevant = communications.filter(item => JSON.stringify([...item.recipients].sort()) === recipientKey
    && group.ids.includes(item.plan_id));
  const stamps = [...new Set(relevant.map(item => item.at))].reverse();
  for (const at of stamps) {
    const items = relevant.filter(item => item.at === at);
    if (group.ids.every(id => items.some(item => item.plan_id === id))) {
      return { status: items.some(item => item.status === "sent") ? "sent" : "copied",
        changed: group.entries.some(({ id, plan }) => items.find(item => item.plan_id === id).plan_revision !== plan.updated_at) };
    }
  }
  return null;
}
export async function recordGroupCopy(date, group, message, get, write) {
  const current = await get(date);
  checkMessageGroup(group, current.data.plans);
  if (!Object.hasOwn(current, "revision") || (current.revision !== null && typeof current.revision !== "string")) {
    throw new Error("予定の保存状態を確認できませんでした。");
  }
  const result = await write({ date, revision: current.revision, operation: "communicate",
    copies: group.entries.map(({ id, plan }) => ({ id, plan_revision: plan.updated_at })),
    recipients: group.recipients, message });
  if (result.saved !== true || result.date !== date) throw new Error("コピー記録の保存完了を確認できませんでした。");
  return result;
}
