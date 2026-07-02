// =========================================================
// diary/weather-box.js
// 天気カード（閲覧専用）
// =========================================================

import { getWeatherByDate, classifyWeather, weatherIcon } from "/common/weather/weather.js";

/**
 * 天気カードを描画する（保存しない）
 * @param {string} date - "2026-07-02"
 */
export async function renderWeatherBox(date) {

  const box = document.getElementById("weatherBox");
  box.innerHTML = "天気データを読み込み中…";

  const data = await getWeatherByDate(date);

  if (!data) {
    box.innerHTML = `
      <div class="weather-card">
        <p>天気データなし</p>
      </div>
    `;
    return;
  }

  // 分類（晴・曇・雨）
  const type = classifyWeather(data.precip, data.sunshine);
  const icon = weatherIcon(type);

  // UI表示（タイトルなし・観測地点なし）
  box.innerHTML = `
    <div class="weather-card">

      <p class="weather-icon">${icon} ${type}</p>

      <p><strong>最高：</strong> ${data.tmax}℃ / <strong>最低：</strong> ${data.tmin}℃</p>
      <p><strong>降水量：</strong> ${data.precip}mm / <strong>日照時間：</strong> ${data.sunshine}h</p>

    </div>
  `;
}
