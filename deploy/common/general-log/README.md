# 🌾 general-log — 汎用ログエンジン（Yamamoto Farm OS）

`common/general-log/` は、山本農園 OS における  
**施肥・防除・潅水・栽培管理など、圃場単位で管理する全ログの共通エンジン**です。

播種・定植・収穫・出荷のような CSV ベースのワークフローとは異なり、  
**構造化された JSON を圃場ごとに保存する方式**を採用しています。

このフォルダの目的は：

- ログ保存処理の共通化  
- 複数圃場への按分保存  
- 年次階層の自動生成  
- インデックス（〇〇-index.json）の自動更新  
- 各ログタイプの追加を容易にする  

です。

---

# 📁 ディレクトリ構造
    common/
        general-log/
            base.js          ← 汎用エンジン（共通処理）
            fertilizer.js    ← 施肥ログ用ラッパー
            pesticide.js     ← 防除ログ用ラッパー
            water.js         ← 潅水ログ用ラッパー

---

# 🗂 保存場所（データ）

各ログは **圃場ごとに 1 ファイル**で管理します。
    logs/〇〇/圃場名.json

例：
    logs/fertilizer/ぎょうざ東1.json
    logs/pesticide/ぎょうざ東2.json


中身は共通フォーマット：

```json
{
  "field": "ぎょうざ東1",
  "years": {
    "2026": {
      "entries": [
        { ... }
      ]
    }
  }
}

# 🗂 インデックス
data/〇〇-index.json
例：
{
  "ぎょうざ東1": {
    "2026": ["2026-05-10-硫安.json"]
  }
}

- 圃場 × 年ごとのログファイル一覧  
- 一覧ページの高速化に使用  
- 必須ではないがあると便利

---

## 3. 汎用エンジン（common/general-log/base.js）
- JSON 読み込み・保存  
- 年次階層の自動生成  
- 複数圃場への按分保存  
- インデックス更新  
- 各ログタイプが共通で使う基盤ロジック

---

## 4. 各ログタイプのラッパー
    common/general-log/fertilizer.js
    common/general-log/pesticide.js
    common/general-log/water.js

- base.js を呼び出すだけの薄いラッパー  
- ログタイプ固有のフィールドを entry にまとめて渡す  
- 新しいログタイプを追加する場合はこのファイルを作るだけ

---

## 5. UI ページ
    fertilizer/index.html
    fertilizer/fertilizer.js
    pesticide/index.html
    pesticide/pesticide.js

- 圃場の複数選択  
- 肥料/農薬/水量などの入力  
- 保存ボタン → general-log に渡す  
- ロジックは base.js に集約されるため UI は軽量

---

## 6. 全体の流れ
1. UI で複数圃場を選択  
2. UI で数量・薬剤・肥料などを入力  
3. general-log に 1 つのログとして渡す  
4. base.js が圃場ごとに按分して保存  
5. 必要に応じて index を更新  

---

## 7. この構造のメリット
- JSON で構造化されたログ管理  
- 複数圃場の一括入力が可能  
- 按分処理が自動  
- 年次管理が自動  
- 新しいログタイプを簡単に追加できる  
- UI は軽く、ロジックは共通化  
- 後継者にも理解しやすい  

