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

// ───── 時刻・実働・人件費の計算（編集モード用。運用ルール第3条の休憩を再現） ─────

export function hmToMin(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((text || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function toInputTime(text) {
  const min = hmToMin(text);
  if (min === null) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// 開始〜終了から実働時間（h）。正午またぎは休憩60分、またがないときは10分。
export function workHours(startText, endText, breaks) {
  const start = hmToMin(startText);
  const end = hmToMin(endText);
  if (start === null || end === null || end <= start) return null;
  const brk = start < 720 && 720 < end ? breaks.spanning_noon : breaks.not_spanning_noon;
  return Math.max(0, Math.round(((end - start - brk) / 60) * 100) / 100);
}

// シナリオに「月の基本時間帯」と「個別編集」を適用した実効アイテム列を作る。
// overrides: { "date:person": { status: "fixed"|"extra"|"hold", start?, end?, hours? } }
export function applyAdjustments(plan, scenario, overrides = {}, base = null) {
  const breaks = plan.targets.break_minutes;
  const defaults = plan.targets.allday_default;
  const baseChanged = base && defaults && (base.start !== defaults.start || base.end !== defaults.end);
  const baseHours = baseChanged ? workHours(base.start, base.end, breaks) : null;
  const rawByKey = new Map((plan.requests.items || []).map((row) => [`${row.date}:${row.person}`, row]));
  return scenario.items.map((item) => {
    const key = `${item.date}:${item.person}`;
    const override = overrides[key];
    const raw = rawByKey.get(key);
    const status = override?.status || itemKind(item);
    const start = override?.start || raw?.start || (base ? base.start : "");
    const end = override?.end || item.proposed_end || raw?.end || (base ? base.end : "");
    let hours;
    if (status === "hold") {
      hours = 0;
    } else if (override && Number.isFinite(override.hours)) {
      hours = override.hours;
    } else {
      hours = item.proposed_hours;
      if (baseHours !== null && hours > 0) hours = Math.min(hours, baseHours);
    }
    const reason = status === "hold" && override ? (item.reason || "手動で見送りに変更") : item.reason;
    return { ...item, key, status, start, end, reason,
             proposed_hours: hours, proposed_end: status === "hold" ? "" : end, edited: !!override };
  });
}

// 人件費（交通費込み）をブラウザ内で再計算
export function computeCost(effItems, plan) {
  const commute = plan.targets.commute;
  const hourlyOf = new Map(plan.staff.map((s) => [s.name, s.hourly ?? plan.targets.base_hourly]));
  const per = new Map();
  for (const item of effItems) {
    if (item.status === "hold" || item.proposed_hours <= 0) continue;
    const row = per.get(item.person) || { days: 0, hours: 0 };
    row.days += 1;
    row.hours += item.proposed_hours;
    per.set(item.person, row);
  }
  let total = 0;
  const perPerson = {};
  for (const [name, row] of per) {
    const cost = row.hours * (hourlyOf.get(name) ?? plan.targets.base_hourly)
      + Math.min(row.days * commute.per_day, commute.monthly_cap);
    perPerson[name] = { days: row.days, hours: Math.round(row.hours * 100) / 100, cost: Math.round(cost) };
    total += cost;
  }
  return { total: Math.round(total), perPerson };
}

// 開始時刻と実働から終了時刻を逆算（休憩の正午またぎ整合をとる）
export function endTimeFor(startText, hours, breaks) {
  const start = hmToMin(startText);
  if (start === null || !(hours > 0)) return "";
  for (const brk of [breaks.spanning_noon, breaks.not_spanning_noon]) {
    const end = start + Math.round(hours * 60) + brk;
    const spans = start < 720 && 720 < end;
    if ((spans ? breaks.spanning_noon : breaks.not_spanning_noon) === brk) {
      return `${Math.floor(end / 60)}:${String(end % 60).padStart(2, "0")}`;
    }
  }
  return "";
}

// 編集済み（edited）の日はロックし、未編集の勤務日の実働に上限を掛けて予算内に収める。
// 優先する人（protected）は後回し。第6条①のブラウザ内再現。
export function fitRemaining(plan, effItems, budgetMax, step = 0.5) {
  const mx = plan.targets.max_work_hours;
  const mn = plan.targets.min_work_hours;
  const breaks = plan.targets.break_minutes;
  const protectedNames = new Set(plan.staff.filter((s) => s.protected).map((s) => s.name));
  const apply = (capOthers, capProtected) => effItems.map((item) => {
    if (item.edited || item.status === "hold" || item.proposed_hours <= 0) return item;
    const cap = protectedNames.has(item.person) ? capProtected : capOthers;
    if (item.proposed_hours <= cap) return item;
    return { ...item, proposed_hours: cap,
             proposed_end: endTimeFor(item.start, cap, breaks) || item.proposed_end, autoCut: true };
  });
  const steps = [];
  for (let cap = mx; cap >= mn - 1e-9; cap -= step) steps.push(Math.round(cap * 100) / 100);
  if (steps[steps.length - 1] !== mn) steps.push(mn);
  for (const cap of steps) {
    const items = apply(cap, mx);
    if (computeCost(items, plan).total <= budgetMax) {
      return { items, capOthers: cap, capProtected: mx, over: false };
    }
  }
  for (const cap of steps) {
    const items = apply(mn, cap);
    if (computeCost(items, plan).total <= budgetMax) {
      return { items, capOthers: mn, capProtected: cap, over: false };
    }
  }
  return { items: apply(mn, mn), capOthers: mn, capProtected: mn, over: true };
}

// timetree確定操作のチェックリスト（3グループ）
export function buildChecklist(scenario) {
  const groups = { fixed: [], extra: [], hold: [] };
  for (const item of scenario.items) {
    const kind = item.status || itemKind(item);
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
