// schedule/seed/index.js

import { initRows, getRows } from "./seedList-state.js";
import { renderTable } from "./seedList-render.js";

export async function renderSeedList() {
  if (getRows().length === 0) {
    await initRows();
  }
  renderTable();
}
