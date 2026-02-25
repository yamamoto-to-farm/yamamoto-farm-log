export async function loadCSV(url) {
  try {
    const res = await fetch(url + "?ts=" + Date.now());
    const text = await res.text();

    if (!text.trim()) return [];

    const lines = text.trim().split("\n");
    const headers = lines[0].split(",");

    return lines.slice(1).map(line => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || "");
      return obj;
    });

  } catch (e) {
    console.error("[admin] CSV 読み込み失敗:", e);
    return [];
  }
}