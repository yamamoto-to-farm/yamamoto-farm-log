import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";

function buildFieldTree(fields) {
  const byArea = {};
  (Array.isArray(fields) ? fields : []).forEach(f => {
    const area = String(f?.area || "").trim();
    const name = String(f?.name || "").trim();
    if (!area || !name) return;
    if (!byArea[area]) byArea[area] = [];
    if (!byArea[area].includes(name)) byArea[area].push(name);
  });

  const parents = Object.keys(byArea).sort((a, b) => a.localeCompare(b, "ja"));
  const children = {};
  parents.forEach(area => {
    children[area] = byArea[area].slice().sort((a, b) => a.localeCompare(b, "ja"));
  });

  return { parents, children };
}

function resolveFinalField({ autoId, manualId, confirmId }) {
  const autoRaw = String(document.getElementById(autoId)?.value || "").trim();
  const manual = String(document.getElementById(manualId)?.value || "").trim();
  const confirmed = !!document.getElementById(confirmId)?.checked;
  const auto = autoRaw.replace(/（推定）/g, "").trim();

  if (confirmed && auto) return auto;
  if (manual) return manual;
  return auto;
}

function updateFieldDisplay({ autoId, manualId, confirmId, displayId, source }) {
  const finalField = resolveFinalField({ autoId, manualId, confirmId });
  const value = finalField
    ? `${source === "modal" ? "モーダル" : "GPS"}: ${finalField}`
    : "未選択";

  const display = document.getElementById(displayId);
  if (display) display.value = value;
}

function applyFieldSelection(name, { fields, areaId, manualId, confirmId }) {
  const selected = String(name || "").trim();
  if (!selected) return;

  const item = (Array.isArray(fields) ? fields : []).find(f => String(f?.name || "").trim() === selected);
  if (!item) return;

  const areaSel = document.getElementById(areaId);
  const manualSel = document.getElementById(manualId);
  const confirm = document.getElementById(confirmId);

  if (!areaSel || !manualSel) return;

  areaSel.value = String(item.area || "");
  areaSel.dispatchEvent(new Event("change"));

  manualSel.value = selected;
  manualSel.dispatchEvent(new Event("change"));

  if (confirm) confirm.checked = false;
}

export function setupFieldModalPicker(options = {}) {
  const {
    fields = [],
    openBtnId = "openFieldModalBtn",
    displayId = "fieldSelectedResult",
    autoId = "field_auto",
    areaId = "field_area",
    manualId = "field_manual",
    confirmId = "field_confirm"
  } = options;

  const current = getFilterData() || {};
  setFilterData({
    ...current,
    fields: buildFieldTree(fields)
  });

  let source = "gps";

  const openBtn = document.getElementById(openBtnId);
  if (openBtn && openBtn.dataset.boundFieldModal !== "1") {
    openBtn.dataset.boundFieldModal = "1";
    openBtn.addEventListener("click", () => {
      openFieldModal({
        mode: "select",
        onSelect: (name) => {
          applyFieldSelection(name, { fields, areaId, manualId, confirmId });
          source = "modal";
          updateFieldDisplay({ autoId, manualId, confirmId, displayId, source });
        }
      });
    });
  }

  if (displayId) {
    const autoEl = document.getElementById(autoId);
    if (autoEl) {
      autoEl.addEventListener("change", () => {
        const text = String(autoEl.value || "");
        if (text.includes("（推定）")) source = "gps";
        updateFieldDisplay({ autoId, manualId, confirmId, displayId, source });
      });
    }

    [manualId, confirmId].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        updateFieldDisplay({ autoId, manualId, confirmId, displayId, source });
      });
    });

    updateFieldDisplay({ autoId, manualId, confirmId, displayId, source });
  }
}
