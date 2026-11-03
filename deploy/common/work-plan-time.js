const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const validTimeRange = range => range && timePattern.test(range.start)
  && timePattern.test(range.end) && range.start < range.end;
const clock = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

export function mergeTimeRanges(ranges) {
  if (!ranges.every(validTimeRange)) throw new Error("勤務・参加時間の形式が不正です。");
  const result = [];
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = result.at(-1);
    if (last && range.start <= last.end) last.end = last.end > range.end ? last.end : range.end;
    else result.push({ start: range.start, end: range.end });
  }
  return result;
}
export function intersectTimeRanges(left, right) {
  return mergeTimeRanges(left.flatMap(a => right.flatMap(b => {
    const start = a.start > b.start ? a.start : b.start;
    const end = a.end < b.end ? a.end : b.end;
    return start < end ? [{ start, end }] : [];
  })));
}
export function subtractTimeRanges(ranges, occupied) {
  return mergeTimeRanges(occupied).reduce((remaining, busy) => remaining.flatMap(range => {
    if (busy.end <= range.start || busy.start >= range.end) return [range];
    return [
      ...(range.start < busy.start ? [{ start: range.start, end: busy.start }] : []),
      ...(busy.end < range.end ? [{ start: busy.end, end: range.end }] : []),
    ];
  }), mergeTimeRanges(ranges));
}
export function workingTimeRanges(shifts, noonBreak) {
  if (!Number.isInteger(noonBreak) || noonBreak < 0 || noonBreak > 180) {
    throw new Error("昼休憩の設定を確認できません。シフトを読み込み直してください。");
  }
  return mergeTimeRanges(shifts.flatMap(range => range.start < "12:00" && range.end > "12:00" && noonBreak
    ? subtractTimeRanges([range], [{ start: "12:00", end: clock(720 + noonBreak) }]) : [range]));
}
export function assignmentTimeRanges(plan, block, name) {
  if (block.participation && Object.hasOwn(block.participation, name)) return block.participation[name];
  if (!plan.names.includes(name) && !(block.companions || []).includes(name)) return [];
  return validTimeRange(block) ? [{ start: block.start, end: block.end }] : [];
}
export function availableWorkTimes(names, attendance, plans, editingId, otherBlocks, noonBreak) {
  const shifts = Object.fromEntries(names.map(name => {
    if (!attendance[name]?.length) throw new Error(`${name}の出退勤時間を確認できません。シフトを読み込んでください。`);
    return [name, workingTimeRanges(attendance[name], noonBreak)];
  }));
  const occupied = [];
  const unknown = new Set();
  for (const name of names) {
    for (const [id, plan] of Object.entries(plans)) {
      if (id === editingId || plan.off) continue;
      for (const block of plan.blocks) {
        if (!plan.names.includes(name) && !(block.companions || []).includes(name)) continue;
        if (!validTimeRange(block)) unknown.add(name);
        else occupied.push(...assignmentTimeRanges(plan, block, name));
      }
    }
    for (const block of otherBlocks) {
      if (validTimeRange(block)) occupied.push(...intersectTimeRanges(shifts[name], [block]));
    }
  }
  const candidates = subtractTimeRanges(Object.values(shifts).flat(), occupied)
    .filter(range => names.every(name => intersectTimeRanges(shifts[name], [range]).length));
  if (noonBreak > 0) {
    const morning = candidates.find(range => range.end === "12:00");
    const afternoon = candidates.find(range => range.start === clock(720 + noonBreak));
    const span = morning && afternoon ? { start: morning.start, end: afternoon.end } : null;
    if (span && !occupied.some(range => range.start < span.end && span.start < range.end)
      && subtractTimeRanges([span], names.flatMap(name => attendance[name])).every(range =>
      range.start >= "12:00" && range.end <= clock(720 + noonBreak))) {
      candidates.push({ ...span, through: true });
    }
  }
  return { shifts, candidates, unknown: [...unknown] };
}
export function participationForWork(block, names, availability) {
  if (!validTimeRange(block)) throw new Error("パートを含む作業は開始・終了を指定してください。");
  if (!availability.candidates.some(range => range.start <= block.start && range.end >= block.end)) {
    throw new Error("勤務時間外・別作業と重なる時間です。時間候補の範囲内で指定してください。");
  }
  const working = Object.values(availability.shifts).flat();
  if (!working.some(range => range.start <= block.start && block.start < range.end)
    || !working.some(range => range.start < block.end && block.end <= range.end)) {
    throw new Error("開始・終了は昼休憩中ではなく、作業できる時間に指定してください。");
  }
  const participation = Object.fromEntries(names.map(name => [name, intersectTimeRanges(availability.shifts[name], [block])]));
  if (Object.values(participation).some(ranges => !ranges.length)) {
    throw new Error("この作業時間に参加できないパートがいます。作業者または時間を変更してください。");
  }
  return participation;
}
export function validTimeMap(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.values(value).every(ranges => Array.isArray(ranges) && ranges.length > 0
      && ranges.every((range, index) => validTimeRange(range) && (!index || ranges[index - 1].end <= range.start)));
}
