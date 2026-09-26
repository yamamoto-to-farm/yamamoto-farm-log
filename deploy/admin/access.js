import { verifyLocalAuth, bumpAuthVersion } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

window.addEventListener("DOMContentLoaded", async () => {
  const authenticated = await verifyLocalAuth();
  if (!authenticated) return;
  if (window.currentRole !== "admin") {
    alert("このページは管理者のみ利用できます");
    location.href = "/admin/index.html";
    return;
  }

  renderHeader({ adminPage: true });
  document.getElementById("page-area").style.display = "block";

  const response = await fetch(`/data/workers.json?v=${Date.now()}`);
  if (!response.ok) {
    alert("従業員データを読み込めませんでした");
    return;
  }
  let accounts = await response.json();
  accounts = Array.isArray(accounts) ? accounts.map(account => ({ ...account })) : [];

  const list = document.getElementById("employee-list");
  const employeeIndices = () => accounts
    .map((account, index) => account?.role === "worker" ? index : -1)
    .filter(index => index >= 0);

  function render() {
    list.innerHTML = "";
    const indices = employeeIndices();
    if (!indices.length) {
      const empty = document.createElement("p");
      empty.className = "info-line";
      empty.textContent = "従業員はまだ登録されていません。";
      list.appendChild(empty);
    }

    indices.forEach(index => {
      const employee = accounts[index];
      const section = document.createElement("section");
      section.className = "card employee-row";
      section.dataset.index = String(index);

      const idRow = document.createElement("div");
      idRow.className = "form-row";
      const idLabel = document.createElement("label");
      idLabel.className = "form-label";
      idLabel.textContent = "識別名";
      const idInput = document.createElement("input");
      idInput.className = "form-input employee-name";
      idInput.value = String(employee.name || "");
      idInput.autocomplete = "off";
      idRow.append(idLabel, idInput);

      const displayRow = document.createElement("div");
      displayRow.className = "form-row";
      const displayLabel = document.createElement("label");
      displayLabel.className = "form-label";
      displayLabel.textContent = "表示名";
      const displayInput = document.createElement("input");
      displayInput.className = "form-input employee-display";
      displayInput.value = String(employee.display || "");
      displayInput.autocomplete = "off";
      displayRow.append(displayLabel, displayInput);

      const statusRow = document.createElement("div");
      statusRow.className = "form-row";
      const statusLabel = document.createElement("label");
      statusLabel.className = "form-label";
      statusLabel.textContent = "在籍状況";
      const statusSelect = document.createElement("select");
      statusSelect.className = "form-input employee-status";
      statusSelect.innerHTML = '<option value="active">在籍中</option><option value="retired">退職済み</option>';
      statusSelect.value = employee.employmentStatus === "retired" ? "retired" : "active";
      statusRow.append(statusLabel, statusSelect);

      section.append(idRow, displayRow, statusRow);
      list.appendChild(section);
    });
  }

  document.getElementById("add-employee-btn").addEventListener("click", () => {
    accounts.push({ pin: "", name: "", display: "", role: "worker", employmentStatus: "active" });
    render();
    list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
    list.lastElementChild?.querySelector(".employee-name")?.focus();
  });

  document.getElementById("save-employees-btn").addEventListener("click", async () => {
    const nextAccounts = accounts.map(account => ({ ...account }));
    const usedNames = new Set(nextAccounts
      .filter(account => account?.role !== "worker")
      .map(account => String(account?.name || "").trim())
      .filter(Boolean));
    let retiring = false;

    for (const row of list.querySelectorAll(".employee-row")) {
      const index = Number(row.dataset.index);
      const name = row.querySelector(".employee-name").value.trim();
      const display = row.querySelector(".employee-display").value.trim();
      const employmentStatus = row.querySelector(".employee-status").value;
      if (!name || !display) {
        alert("識別名と表示名を入力してください。");
        return;
      }
      if (usedNames.has(name)) {
        alert(`識別名「${name}」が重複しています。`);
        return;
      }
      usedNames.add(name);
      const previous = nextAccounts[index];
      if (employmentStatus === "retired" && previous.employmentStatus !== "retired") retiring = true;
      nextAccounts[index] = {
        ...previous,
        name,
        display,
        role: "worker",
        employmentStatus,
        pin: employmentStatus === "retired" ? "" : String(previous.pin || "")
      };
    }

    if (retiring && !confirm("退職済みにする従業員のPINを削除し、ログインできなくします。従業員情報は保存して残します。続けますか？")) return;

    showSaveModal("保存しています…");
    try {
      await saveJSON("data/workers.json", nextAccounts);
      await bumpAuthVersion("employee roster updated");
      accounts = nextAccounts;
      completeSaveModal("保存が完了しました");
      render();
    } catch (error) {
      console.error("従業員データの保存に失敗しました:", error);
      completeSaveModal("保存に失敗しました");
    }
  });

  render();
});