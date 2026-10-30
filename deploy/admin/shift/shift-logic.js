// シフト案ページの純粋ロジック（DOMに依存しない。node --test でテスト可能）

export const WEEKDAYS = "日月火水木金土";

// プランの予算シナリオ一覧（スライダーの目盛り）
export function scenarioBudgets(plan) {
  return plan.scenarios.map((s) => s.budget_max);
}

// 既定予算のシナリオ位置（見つからなければ最後＝最大予算）
export function defaultScenarioIndex(plan) {
  const index = scenarioBudgets(plan).indexOf(plan.default_budget_max);
  return index >= 0 ? index : plan.scenarios.length - 1;
}

// 案の項目の種類: fixed=確定（決まった曜日）/ extra=確定の目安（追加）/ hold=保留・見送り
export function itemKind(item) {
  if (!item.action.startsWith("確定")) return "hold";
  return item.fixed_weekday ? "fixed" : "extra";
}

// 月のカレンダー（月曜はじまり。運用ルールの週＝月〜日に合わせる）
export function buildCalendar(month, items) {
  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const byDate = new Map();
  for (const item of items) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  const weeks = [];
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  let week = new Array((firstDow + 6) % 7).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const dow = new Date(Date.UTC(year, mon - 1, day)).getUTCDay();
    const dayItems = (byDate.get(date) || [])
      .slice()
      .sort((a, b) => a.person.localeCompare(b.person, "ja"));
    week.push({ date, day, weekday: WEEKDAYS[dow], items: dayItems });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push(week.concat(new Array(7 - week.length).fill(null)));
  return weeks;
}

// 人ごとの色（timetreeの色に合わせた固定割り当て。それ以外はフォールバック）
export const PERSON_COLORS = {
  "若月": "#0288d1", // 水色系
  "石原": "#0d47a1", // マリンブルー系
  "土井": "#673ab7", // すみれ色
  "木村": "#827717", // オリーブ
};
export const FALLBACK_COLORS = ["#2e7d32", "#ef6c00", "#00838f", "#6d4c41", "#455a64"];

export function personColorMap(staff) {
  const map = new Map();
  let fallback = 0;
  for (const member of staff) {
    map.set(member.name, PERSON_COLORS[member.name] || FALLBACK_COLORS[fallback++ % FALLBACK_COLORS.length]);
  }
  return map;
}

// timetree確定操作のチェックリスト（3グループ）
export function buildChecklist(scenario) {
  const groups = { fixed: [], extra: [], hold: [] };
  for (const item of scenario.items) {
    const kind = itemKind(item);
    const md = `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`;
    const head = `${md}(${item.weekday}) ${item.person} 「${item.raw_title}」`;
    const shortened = item.proposed_end && item.proposed_hours > 0 && item.proposed_hours < item.request_hours;
    let label;
    if (kind === "fixed") {
      label = `${head} → 「希」を外して確定` +
        (shortened ? `（終了を ${item.proposed_end} に短縮・実働${item.proposed_hours}h。前日までに本人へ連絡）` : "");
    } else if (kind === "extra") {
      label = `${head} → 今は「希」のまま。勤務3日前までに確定（「希」を外す・目安 実働${item.proposed_hours}h` +
        (shortened ? `・終了 ${item.proposed_end}` : "") + "）か、見送りを連絡";
    } else {
      label = `${head} → 保留。見送りなら3日前までに連絡` + (item.reason ? `（${item.reason}）` : "");
    }
    groups[kind].push({ id: `${item.date}:${item.person}`, date: item.date, label });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.date.localeCompare(b.date));
  return groups;
}

// 人別サマリ行（予定日数・目標・人件費）
export function personRows(plan, scenario) {
  return plan.staff.map((member) => ({
    name: member.name,
    days: scenario.per_person_days[member.name] ?? 0,
    target: member.target_days ?? null,
    cost: scenario.per_person_cost[member.name] ?? 0,
    protected: !!member.protected,
  }));
}

export function formatYen(value) {
  return `${Number(value).toLocaleString("ja-JP")}円`;
}
