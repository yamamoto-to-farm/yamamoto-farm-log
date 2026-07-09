export function collectUniqueMethods(rows, getMethod) {
  const set = new Set();

  (rows || []).forEach(row => {
    const value = String(getMethod?.(row) || "").trim();
    if (value) set.add(value);
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
}

export function matchesSharedListFilters({
  selectedFields = [],
  selectedMethod = "",
  keyword = "",
  rowFields = [],
  rowMethod = "",
  searchValues = []
}) {
  const fields = Array.isArray(rowFields)
    ? rowFields.map(v => String(v || "").trim()).filter(Boolean)
    : [];

  if (Array.isArray(selectedFields) && selectedFields.length > 0) {
    if (!selectedFields.some(f => fields.includes(String(f || "").trim()))) {
      return false;
    }
  }

  const method = String(rowMethod || "").trim();
  if (selectedMethod && method !== String(selectedMethod).trim()) {
    return false;
  }

  const kw = String(keyword || "").trim().toLowerCase();
  if (kw) {
    const hay = (searchValues || [])
      .map(v => String(v || "").toLowerCase())
      .join(" ");
    if (!hay.includes(kw)) {
      return false;
    }
  }

  return true;
}
