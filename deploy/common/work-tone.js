const WORK_TONE_RULES = [
  { tone: "tone-discard", keywords: ["廃棄", "破棄"] },
  { tone: "tone-harvest", keywords: ["収穫"] },
  { tone: "tone-care", keywords: ["除草", "草刈", "防除", "施肥", "潅水", "手作業除草"] },
  { tone: "tone-field", keywords: ["耕起", "中耕", "畝立", "圃場整備", "土づくり"] },
  { tone: "tone-start", keywords: ["播種", "定植", "育苗"] }
];

export function getWorkToneClass(value) {
  const text = String(value || "").trim();
  if (!text) return "tone-start";

  for (const rule of WORK_TONE_RULES) {
    if (rule.keywords.some(keyword => text.includes(keyword))) {
      return rule.tone;
    }
  }

  return "tone-start";
}