// ===============================
// 共通ロジック（GPS / 圃場判定 / CSV生成）
// ===============================

// -------------------------------
// 1. GPS取得
// -------------------------------
export function getCurrentPosition(timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject("GPSが利用できません");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                resolve({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
            },
            (err) => reject("GPS取得に失敗：" + err.message),
            {
                enableHighAccuracy: true,
                timeout: timeout,
                maximumAge: 0
            }
        );
    });
}

// -------------------------------
// 2. 圃場データの読み込み
// -------------------------------
let fieldsData = [];

export async function loadFields() {
    if (fieldsData.length > 0) return fieldsData;

    const res = await fetch("/yamamoto-farm-log/data/fields.json");
    fieldsData = await res.json();
    return fieldsData;
}

// -------------------------------
// 3. 距離計算（中心点方式）
// -------------------------------
function calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 地球半径（m）
    const toRad = (v) => (v * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// -------------------------------
// 4. 圃場判定（閾値なし → 最も近い圃場を必ず返す）
// -------------------------------
export async function getNearestField(lat, lng) {
    const fields = await loadFields();

    let nearest = null;
    let minDist = Infinity;

    for (const f of fields) {
        const dist = calcDistance(lat, lng, f.lat, f.lng);
        if (dist < minDist) {
            minDist = dist;
            nearest = { ...f, distance: dist };
        }
    }

    // ★ 閾値なし → UNKNOWN を返さない
    return nearest;
}

// -------------------------------
// 5. タイムスタンプ生成
// -------------------------------
export function getTimestamp() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// -------------------------------
// 6. CSV行生成（Access / Obsidian対応）
// -------------------------------
export function createCsvRow(data) {
    const row = [
        data.timestamp,
        data.category,
        data.field_id,
        data.field_name,
        data.area,
        data.lat,
        data.lng,
        data.accuracy,
        data.worker || "",
        data.memo || ""
    ];

    return row.map((v) => `"${v}"`).join(",") + "\n";
}

// -------------------------------
// 7. CSVダウンロード
// -------------------------------
export function downloadCsv(filename, content) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
}