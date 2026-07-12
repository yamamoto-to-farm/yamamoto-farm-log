// common/field-contract.js

function toDateKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const normalized = raw.replace(/\//g, "-").replace(/\./g, "-").trim();
  const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "";

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return "";
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";

  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function todayDateKey(today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function getLatestContractEndKey(detail) {
  if (!detail || typeof detail !== "object") return "";
  const contracts = Array.isArray(detail.contracts) ? detail.contracts : [];

  let latest = "";
  contracts.forEach(contract => {
    const key = toDateKey(contract?.end);
    if (!key) return;
    if (!latest || key > latest) latest = key;
  });

  return latest;
}

export function isFieldContractExpired(detail, today = new Date()) {
  const latestEnd = getLatestContractEndKey(detail);
  if (!latestEnd) return false;
  return latestEnd <= todayDateKey(today);
}

export function buildExpiredFieldNameSet(fieldDetail, today = new Date()) {
  const out = new Set();
  if (!fieldDetail || typeof fieldDetail !== "object") return out;

  Object.entries(fieldDetail).forEach(([fieldName, detail]) => {
    if (fieldName === "TEMPLATE_FIELD") return;
    if (isFieldContractExpired(detail, today)) out.add(fieldName);
  });

  return out;
}
