import { safeFieldName } from "/common/utils.js?v=20260811-1";

const token = value => String(value ?? "").normalize("NFKC").trim();
const workers = value => [...new Set((Array.isArray(value) ? value : [value])
  .flatMap(item => token(item).split(/[\/／、,\n]/)).map(token).filter(Boolean))].sort().join("/");
const sameCrew = (a, b) => workers(a.workers) === workers(b.workers) && token(a.machine) === token(b.machine);
const fields = value => String(value || "").split(/[\/／]/).map(field => field.trim()).filter(Boolean);
const fieldKey = values => [...new Set(values.flatMap(fields).map(token))].sort().join("/");

export async function loadFertilizerDetails(logs, date) {
  const fieldNames = [...new Set(logs.filter(log => log.folder === "fertilizer")
    .flatMap(log => fields(log.data.field)))];
  const results = await Promise.all(fieldNames.map(async field => {
    try {
      const response = await fetch(`/logs/fertilizer/${encodeURIComponent(safeFieldName(field))}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`施肥の元記録を取得できません（${response.status}）。`);
      const data = await response.json();
      const entries = data?.years?.[date.slice(0, 4)]?.entries;
      if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.date !== "string"
        || (entry.distributed !== undefined && (!Array.isArray(entry.distributed)
          || entry.distributed.some(item => !item || typeof item !== "object"))))) {
        throw new Error("施肥の元記録の形式が不正です。");
      }
      return { field, entries: entries.filter(entry => entry.date === date) };
    } catch (error) {
      console.error("[diary] fertilizer details failed", field, error);
      return { field, entries: [], error: `${field}：${error.message}` };
    }
  }));
  return { entries: results.flatMap(result => result.entries.map(entry => ({ ...entry, field: result.field }))),
    errors: results.filter(result => result.error).map(result => result.error) };
}

export function combineSimultaneousWork(workList, autoList, details) {
  const rawByKey = new Map();
  for (const item of autoList) rawByKey.set(item.sourceKey, rawByKey.has(item.sourceKey) ? null : item);
  const groups = workList.map(group => ({ ...group, items: (group.items || [group]).map(item => ({ ...item })),
    rawItems: (group.items || [group]).map(item => rawByKey.get(item.sourceKey)).filter(Boolean),
    simultaneous: [] }));
  const removed = new Set();
  for (const fertilizer of groups) {
    if (!fertilizer.rawItems.length || !fertilizer.rawItems.every(item => item.folder === "fertilizer")
      || fertilizer.rawItems.length !== fertilizer.items.length) continue;
    const matches = fertilizer.rawItems.map(item => {
      const fieldNames = fields(item.field);
      const entries = details.filter(entry => fieldNames.some(field => token(entry.field) === token(field))
        && entry.date === item.date && sameCrew(entry, item));
      if (entries.some(entry => entry.sourceWork)) fertilizer.linkWarning = true;
      if (!fieldNames.length || entries.length !== fieldNames.length
        || fieldNames.some(field => entries.filter(entry => token(entry.field) === token(field)).length !== 1)) return null;
      const entry = entries[0];
      if (!["intertill", "bedmaking"].includes(entry.sourceWork) || !entry.sourceWorkType
        || entries.some(other => other.sourceWork !== entry.sourceWork || other.sourceWorkType !== entry.sourceWorkType)) return null;
      const candidates = groups.flatMap(group => group.rawItems.filter(raw =>
        raw.folder === entry.sourceWork && raw.date === item.date && token(raw.field) === token(item.field)
        && token(raw.sowingCategory) === token(entry.sourceWorkType) && sameCrew(raw, item))
        .map(raw => ({ group, raw })));
      if (candidates.length !== 1) return null;
      return { ...candidates[0], entries, item };
    });
    const parent = matches[0]?.group;
    if (!parent || matches.some(match => !match || match.group !== parent)) continue;
    // A diary may have custom merged crews/times. Do not hide those differences.
    if (!sameCrew(parent, fertilizer) || parent.start !== fertilizer.start || parent.end !== fertilizer.end
      || fieldKey([parent.field]) !== fieldKey(parent.rawItems.map(item => item.field))
      || fieldKey([fertilizer.field]) !== fieldKey(fertilizer.rawItems.map(item => item.field))) continue;
    const competing = groups.filter(group => group !== fertilizer && group.rawItems.some(raw =>
      raw.folder === "fertilizer" && matches.some(match => raw.date === match.item.date
        && token(raw.field) === token(match.item.field) && sameCrew(raw, match.item))));
    if (competing.length) continue;
    parent.simultaneous.push(...matches.flatMap(match => match.entries.map(entry => ({ ...entry }))));
    parent.rawItems.push(...fertilizer.rawItems);
    removed.add(fertilizer);
  }
  const displayed = groups.filter(group => !removed.has(group));
  const references = [];
  displayed.forEach((group, index) => {
    group.anchor = `actual-work-${index}`;
    group.rawItems.forEach(item => {
      references[item.logIndex] = { anchor: group.anchor, start: group.start || "", end: group.end || "" };
    });
  });
  return { groups: displayed, references };
}
