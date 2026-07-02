import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";

import { showFolderList } from "./work-summary.js";

window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  renderHeader();

  document.getElementById("form-area").style.display = "block";

  // フォルダ一覧を表示
  showFolderList();
});
