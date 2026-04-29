// kpi-filter.js
// KPI（年間・月次）共通フィルタエンジン（年度 + 品種フィルタ）

let selectedYears = [];
let selectedVarieties = [];  // 子（variety）

let kpiFilterData = {
  years: [],
  varieties: { parents: [], children: {} }
};

export function setKpiFilterData(data) {
  kpiFilterData = data;
  renderActiveFilters();
}

/* ============================================================
   activeFilters の描画
============================================================ */
function renderActiveFilters() {
  const area = document.getElementById("activeFilters");
  if (!area) return;

  area.innerHTML = "";

  // 年度
  selectedYears.forEach(y => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `${y}<span class="filter-tag-remove" data-year="${y}">×</span>`;
    area.appendChild(div);
  });

  // 品種
  selectedVarieties.forEach(v => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `${v}<span class="filter-tag-remove" data-variety="${v}">×</span>`;
    area.appendChild(div);
  });

  if (selectedYears.length || selectedVarieties.length) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "filter-reset-btn";
    resetBtn.textContent = "全解除";
    resetBtn.onclick = () => resetKpiFilters();
    area.appendChild(resetBtn);
  }

  document.querySelectorAll(".filter-tag-remove").forEach(el => {
    if (el.dataset.year) {
      el.onclick = () => {
        selectedYears = selectedYears.filter(v => v !== el.dataset.year);
        applyKpiFilters();
      };
    }
    if (el.dataset.variety) {
      el.onclick = () => {
        selectedVarieties = selectedVarieties.filter(v => v !== el.dataset.variety);
        applyKpiFilters();
      };
    }
  });
}

/* ============================================================
   全解除
============================================================ */
export function resetKpiFilters() {
  selectedYears = [];
  selectedVarieties = [];
  applyKpiFilters();
  window.dispatchEvent(new Event("kpi-filter:reset"));
}

/* ============================================================
   KPI フィルタ適用
============================================================ */
function applyKpiFilters() {
  const state = {
    years: selectedYears,
    varieties: selectedVarieties
  };
  renderActiveFilters();
  window.dispatchEvent(new CustomEvent("kpi-filter:apply", { detail: state }));
}

/* ============================================================
   ▼ 年フィルタ（単層）
============================================================ */
export function openKpiYearModal() {
  const container = document.getElementById("modal-container");
  container.style.display = "block";

  container.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>
        <h3>年度の選択</h3>

        ${kpiFilterData.years.map(y => `
          <div class="select-item" data-year="${y}">${y}</div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;

  initKpiYearModalEvents();
}

function initKpiYearModalEvents() {
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  document.querySelectorAll("[data-year]").forEach(el => {
    el.onclick = () => {
      const y = el.dataset.year;
      if (selectedYears.includes(y)) {
        selectedYears = selectedYears.filter(v => v !== y);
      } else {
        selectedYears.push(y);
      }
      updateYearSelections();
    };
  });

  document.getElementById("clear").onclick = () => {
    selectedYears = [];
    updateYearSelections();
  };

  document.getElementById("apply").onclick = () => {
    applyKpiFilters();
    closeModal();
  };

  updateYearSelections();
}

function updateYearSelections() {
  document.querySelectorAll("[data-year]").forEach(el => {
    el.classList.toggle("selected", selectedYears.includes(el.dataset.year));
  });
}

/* ============================================================
   ▼ 品種フィルタ（2階層：varietyType → variety）
============================================================ */
export function openKpiVarietyModal() {
  const container = document.getElementById("modal-container");
  container.style.display = "block";

  const { parents, children } = kpiFilterData.varieties;

  container.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>
        <h3>品種の選択</h3>

        ${parents.map(type => `
          <div class="parent-item" data-parent="${type}">
            <span class="parent-label">${type}</span>
            <span class="parent-toggle">▼</span>
          </div>

          <div class="child-box" data-box="${type}">
            ${children[type].map(v => `
              <div class="select-item" data-variety="${v}">${v}</div>
            `).join("")}
          </div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;

  initKpiVarietyModalEvents();
}

function initKpiVarietyModalEvents() {
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  // ▼ 親の開閉（▼クリック）
  document.querySelectorAll(".parent-toggle").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const type = el.parentElement.dataset.parent;
      const box = document.querySelector(`[data-box="${type}"]`);
      box.classList.toggle("open");
    };
  });

  // ▼ 親名クリックで全選択／全解除
  document.querySelectorAll(".parent-label").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const type = el.parentElement.dataset.parent;
      const box = document.querySelector(`[data-box="${type}"]`);
      const items = box.querySelectorAll("[data-variety]");

      const allSelected = [...items].every(i => selectedVarieties.includes(i.dataset.variety));

      items.forEach(i => {
        const v = i.dataset.variety;
        if (allSelected) {
          selectedVarieties = selectedVarieties.filter(x => x !== v);
        } else {
          if (!selectedVarieties.includes(v)) selectedVarieties.push(v);
        }
      });

      updateVarietySelections();
    };
  });

  // ▼ 子の選択
  document.querySelectorAll("[data-variety]").forEach(el => {
    el.onclick = () => {
      const v = el.dataset.variety;
      if (selectedVarieties.includes(v)) {
        selectedVarieties = selectedVarieties.filter(x => x !== v);
      } else {
        selectedVarieties.push(v);
      }
      updateVarietySelections();
    };
  });

  document.getElementById("clear").onclick = () => {
    selectedVarieties = [];
    updateVarietySelections();
  };

  document.getElementById("apply").onclick = () => {
    applyKpiFilters();
    closeModal();
  };

  updateVarietySelections();
}

function updateVarietySelections() {
  document.querySelectorAll("[data-variety]").forEach(el => {
    el.classList.toggle("selected", selectedVarieties.includes(el.dataset.variety));
  });
}

/* ============================================================
   モーダルを閉じる
============================================================ */
function closeModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = "";
  container.style.display = "none";
}
