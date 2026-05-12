// -----------------------------
// 編集ページ
// -----------------------------

// ① デフォルト：/data/${dataName}.json
let path = `/data/${dataName}.json`;

// ② dataName の prefix をフォルダ名とみなす
const prefix = dataName.split("-")[0];

// ③ フォルダ構造版：/data/${prefix}/${dataName}.json
const altPath = `/data/${prefix}/${dataName}.json`;

// ④ HEAD で存在チェック
let finalPath = path;

try {
  const head = await fetch(path, { method: "HEAD" });
  if (!head.ok) {
    finalPath = altPath;
  }
} catch {
  finalPath = altPath;
}

// ⑤ JSON 読み込み
const json = await loadJSON(finalPath);

// ⑥ 編集カード読み込み
const module = await import(`./card-edit-${dataName}.js`);

module.renderEditCard({
  dataName,
  fieldName,
  variety,
  json,
  container,
  finalPath
});
