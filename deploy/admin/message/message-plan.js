import { mergeTimeRanges } from "/common/work-plan-time.js?v=20261104-time-1";

export function planRecipients(plan) {
  return plan.recipients || (plan.source === "message" ? plan.names : []);
}

export function communicationIssues(plan) {
  const recipients = planRecipients(plan);
  const participants = new Set([...plan.names, ...plan.blocks.flatMap(block => block.companions || [])]);
  const issues = [];
  if (!recipients.length) issues.push("連絡する作業者を予定編集で選択してください。");
  if (recipients.some(name => !participants.has(name))) issues.push("連絡先が作業者に含まれていません。");
  if (!plan.off) {
    if (recipients.some(name => !plan.attendance?.[name]?.length)) issues.push("出退勤時間を予定編集でシフトから確認・保存してください。");
    if (!plan.blocks.length || plan.blocks.some(block => !block.start || !block.end)) issues.push("連絡には開始・終了時刻が必要です。");
    if (plan.blocks.some(block => !block.shed && !(block.fields?.length || block.field))) issues.push("圃場または作業場集合を指定してください。");
    if (plan.kind === "2" && !recipients.includes(plan.reporter)) issues.push("パートのみの作業は連絡係を指定してください。");
  }
  return issues;
}

function messageDateLabel(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日（${"日月火水木金土"[parsed.getDay()]}）`;
}

export function buildPlanMessage(plan, date, envelope = true) {
  const label = messageDateLabel(date);
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

export function messageGroups(plans, familyNames = new Set()) {
  const idsByPerson = new Map();
  for (const id of Object.keys(plans).sort()) {
    for (const name of planRecipients(plans[id])) {
      if (!idsByPerson.has(name)) idsByPerson.set(name, []);
      idsByPerson.get(name).push(id);
    }
  }
  const groups = new Map();
  for (const [name, ids] of idsByPerson) {
    const active = ids.filter(id => !plans[id].off);
    const attendance = mergeTimeRanges(active.flatMap(id => plans[id].attendance?.[name] || []));
    const attendanceKeys = active.map(id => JSON.stringify(mergeTimeRanges(plans[id].attendance?.[name] || [])));
    const issues = !familyNames.has(name) && new Set(attendanceKeys).size > 1
      ? ["予定間で出退勤時間が異なります。シフトを再読込し、各予定を編集・保存してください。"] : [];
    const personal = ids.map(id => {
      const plan = plans[id];
      const blocks = plan.blocks.flatMap(block => {
        const ranges = block.participation?.[name];
        return ranges ? ranges.map(range => ({ ...block, ...range })) : [block];
      });
      return { id, plan, displayPlan: { ...plan, blocks } };
    });
    const key = JSON.stringify([ids, attendance, personal.map(entry => entry.displayPlan.blocks.map(block =>
      [block.task, block.start, block.end]))]);
    if (!groups.has(key)) groups.set(key, { ids, recipients: [], attendance, personal, issues });
    groups.get(key).recipients.push(name);
  }
  return [...groups.values()].map(group => {
    group.recipients.sort();
    const entries = group.personal.sort((a, b) =>
      (a.displayPlan.blocks[0]?.start || "99:99").localeCompare(b.displayPlan.blocks[0]?.start || "99:99") || a.id.localeCompare(b.id));
    const id = group.ids.length === 1 && group.recipients.length === planRecipients(entries[0].plan).length
      ? group.ids[0] : JSON.stringify([group.ids, group.recipients]);
    return { ...group, entries, id, includesFamily: group.recipients.some(name => familyNames.has(name)) };
  });
}
export function buildGroupMessage(group, date) {
  const attendance = group.attendance.length ? [
    group.includesFamily ? `予定時間：${group.attendance[0].start}〜${group.attendance.at(-1).end}`
      : `出勤：${group.attendance[0].start}　退勤：${group.attendance.at(-1).end}`,
    ...(group.attendance.length > 1 ? [`${group.includesFamily ? "予定時間帯" : "勤務時間帯"}：${group.attendance.map(range => `${range.start}〜${range.end}`).join("／")}`] : []), "",
  ] : [];
  if (group.entries.length === 1 && !attendance.length) return buildPlanMessage(group.entries[0].displayPlan, date);
  return ["お疲れさまです。", `${messageDateLabel(date)}の作業予定です。`, "",
    ...attendance, ...group.entries.map(({ displayPlan }) => buildPlanMessage(displayPlan, date, false)), "よろしくお願いします。"].join("\n");
}
export function checkMessageGroup(group, plans) {
  const current = messageGroups(plans).find(item => item.id === group.id);
  if (!current || current.entries.some(({ id, plan }) =>
    group.entries.find(item => item.id === id)?.plan.updated_at !== plan.updated_at)
    || JSON.stringify(current.attendance) !== JSON.stringify(group.attendance)
    || JSON.stringify(current.entries.map(item => item.displayPlan.blocks)) !== JSON.stringify(group.entries.map(item => item.displayPlan.blocks))) {
    throw new Error("予定が変更・削除されています。再読み込みして連絡内容を確認してください。");
  }
}
export function groupCommunicationState(group, communications) {
  const recipientKey = JSON.stringify(group.recipients);
  const relevant = communications.filter(item => JSON.stringify([...item.recipients].sort()) === recipientKey);
  const stamps = [...new Set(relevant.map(item => item.at))].reverse()
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  for (const at of stamps) {
    const items = relevant.filter(item => item.at === at);
    if (!items.some(item => group.ids.includes(item.plan_id))) continue;
    if (group.ids.every(id => items.some(item => item.plan_id === id))) {
      const changed = items.some(item => !group.ids.includes(item.plan_id))
        || group.entries.some(({ id, plan }) => items.find(item => item.plan_id === id).plan_revision !== plan.updated_at);
      const message = !changed && typeof items[0].message === "string"
        && items.every(item => item.message === items[0].message) ? items[0].message : null;
      return { status: items.some(item => item.status === "sent") ? "sent" : "copied",
        changed, message };
    }
    return null;
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
