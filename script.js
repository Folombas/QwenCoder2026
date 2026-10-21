/* ============================================================
   Интерактивный дашборд Москвы — Vanilla JS
   Блоки: часы (Intl.DateTimeFormat / Europe/Moscow),
          погода (Open-Meteo), live-камера (YouTube embed)
   ============================================================ */

"use strict";

/* ------------------------------ Конфиг ------------------------------ */

const MOSCOW_COORDS = { lat: 55.7558, lon: 37.6173 };

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${MOSCOW_COORDS.lat}&longitude=${MOSCOW_COORDS.lon}` +
  `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
  `&timezone=Europe%2FMoscow`;

/**
 * Список YouTube-стримов с видами центра Москвы (Красная площадь / Москва-Сити).
 * Первый доступный будет встроен в iframe; при проблемах со стримом
 * скрипт автоматически переключается на следующий.
 * ID можно заменить на актуальные прямые эфиры (например, каналы EarthCam / Moscow Live).
 */
const STREAMS = [
  { id: "9833FlHNbdY", title: "Красная площадь — круговая панорама" },
  { id: "K5Xc9bW8zTg", title: "Москва-Сити — прямой эфир" },
  { id: "GCEKkRRLaOM", title: "Вид на Москву — live 24/7" },
];

const WEATHER_REFRESH_MS = 10 * 60 * 1000; // автообновление погоды каждые 10 минут

/* ------------------------- Маппер WMO-кодов ------------------------- */

/**
 * Перевод кода погоды WMO (Open-Meteo) в эмодзи и русское описание.
 * @param {number} code — weather_code из API
 * @param {boolean} isNight — ночь ли сейчас в Москве (влияет на иконку)
 * @returns {{icon: string, iconNight: string, desc: string}}
 */
function mapWeatherCode(code, isNight = false) {
  const table = {
    0:  { icon: "☀️", night: "🌙", desc: "Ясно" },
    1:  { icon: "🌤️", night: "🌙", desc: "Преимущественно ясно" },
    2:  { icon: "⛅", night: "☁️", desc: "Переменная облачность" },
    3:  { icon: "☁️", night: "☁️", desc: "Пасмурно" },
    45: { icon: "🌫️", night: "🌫️", desc: "Туман" },
    48: { icon: "🌫️", night: "🌫️", desc: "Изморозь и туман" },
    51: { icon: "🌦️", night: "🌧️", desc: "Лёгкая морось" },
    53: { icon: "🌦️", night: "🌧️", desc: "Морось" },
    55: { icon: "🌧️", night: "🌧️", desc: "Сильная морось" },
    56: { icon: "🌧️", night: "🌧️", desc: "Ледяная морось" },
    57: { icon: "🌧️", night: "🌧️", desc: "Сильная ледяная морось" },
    61: { icon: "🌦️", night: "🌧️", desc: "Небольшой дождь" },
    63: { icon: "🌧️", night: "🌧️", desc: "Дождь" },
    65: { icon: "🌧️", night: "🌧️", desc: "Сильный дождь" },
    66: { icon: "🌧️", night: "🌧️", desc: "Ледяной дождь" },
    67: { icon: "🌧️", night: "🌧️", desc: "Сильный ледяной дождь" },
    71: { icon: "🌨️", night: "❄️", desc: "Небольшой снег" },
    73: { icon: "🌨️", night: "❄️", desc: "Снег" },
    75: { icon: "❄️", night: "❄️", desc: "Сильный снегопад" },
    77: { icon: "🌨️", night: "🌨️", desc: "Снежные зёрна" },
    80: { icon: "🌦️", night: "🌧️", desc: "Ливень (слабый)" },
    81: { icon: "🌧️", night: "🌧️", desc: "Ливень" },
    82: { icon: "⛈️", night: "⛈️", desc: "Сильный ливень" },
    85: { icon: "🌨️", night: "❄️", desc: "Снегопад (ливневый)" },
    86: { icon: "❄️", night: "❄️", desc: "Сильный снегопад (ливневый)" },
    95: { icon: "⛈️", night: "⛈️", desc: "Гроза" },
    96: { icon: "⛈️", night: "⛈️", desc: "Гроза с градом" },
    99: { icon: "⛈️", night: "⛈️", desc: "Сильная гроза с градом" },
  };

  const item = table[code] ?? { icon: "🌡️", night: "🌡️", desc: "Неизвестные условия" };
  return { icon: isNight ? item.night : item.icon, desc: item.desc };
}

/* ------------------------------ Часы ------------------------------ */

// Форматтеры на базе Intl.DateTimeFormat — время точное для MSK,
// независимо от часового пояса устройства пользователя.
const timeFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const partsFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const el = (id) => document.getElementById(id);

const clockTimeEl = el("clock-time");
const clockDateEl = el("clock-date");
const dayProgressEl = el("day-progress");
const dayProgressValueEl = el("day-progress-value");

function getMoscowParts(now = new Date()) {
  const parts = {};
  for (const p of partsFmt.formatToParts(now)) parts[p.type] = p.value;
  return parts; // { hour, minute, second, ... }
}

function isMoscowNight(now = new Date()) {
  const h = Number(getMoscowParts(now).hour);
  return h < 5 || h >= 22;
}

function updateClock() {
  const now = new Date();
  const time = timeFmt.format(now); // "ЧЧ:ММ:СС" по МСК
  const date = dateFmt.format(now); // "понедельник, 22 октября 2026 г."

  clockTimeEl.textContent = time;
  clockTimeEl.setAttribute(
    "datetime",
    `${now.toISOString()}`
  );
  clockDateEl.textContent = date.charAt(0).toUpperCase() + date.slice(1);

  // Индикатор «часть дня пройдена» в Москве
  const { hour, minute, second } = getMoscowParts(now);
  const secondsOfDay = Number(hour) * 3600 + Number(minute) * 60 + Number(second);
  const pct = (secondsOfDay / 86400) * 100;
  dayProgressEl.style.width = `${pct.toFixed(2)}%`;
  dayProgressValueEl.textContent = `${Math.floor(pct)}%`;
}

function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

/* ------------------------------ Погода ------------------------------ */

const weatherLoader = el("weather-loader");
const weatherContent = el("weather-content");
const weatherError = el("weather-error");

function showWeatherState(state) {
  weatherLoader.classList.toggle("hidden", state !== "loading");
  weatherContent.classList.toggle("hidden", state !== "ready");
  weatherError.classList.toggle("hidden", state !== "error");
  weatherContent.setAttribute("aria-hidden", String(state !== "ready"));
}

async function loadWeather() {
  showWeatherState("loading");
  try {
    const res = await fetch(OPEN_METEO_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const cur = json?.current;
    if (!cur || typeof cur.temperature_2m !== "number") {
      throw new Error("Некорректный ответ API");
    }

    const { icon, desc } = mapWeatherCode(cur.weather_code, isMoscowNight());

    el("w-icon").textContent = icon;
    el("w-temp").textContent = Math.round(cur.temperature_2m);
    el("w-desc").textContent = `${desc} · Москва`;
    el("w-humidity").textContent = cur.relative_humidity_2m;
    el("w-wind").textContent = Math.round(cur.wind_speed_10m);
    el("w-feels").textContent = Math.round(cur.apparent_temperature);

    showWeatherState("ready");
  } catch (err) {
    console.error("[Dashboard] Ошибка загрузки погоды:", err);
    showWeatherState("error");
  }
}

/* --------------------------- Веб-камера --------------------------- */

const cameraFrame = el("camera-frame");
const videoFallback = el("video-fallback");

function buildEmbedSrc(id) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    loop: "1",
    playlist: id,
    controls: "1",
    modestbranding: "1",
    rel: "0",
  });
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

let currentStreamIndex = 0;

/** При недоступности стрима показываем фолбэк и пробуем следующий источник. */
function setupCamera() {
  cameraFrame.addEventListener("loadstart", () => {
    videoFallback.classList.add("hidden");
  });

  // Если пользователь кликнул по фолбэку — пробуем следующий стрим
  videoFallback.addEventListener("click", switchToNextStream);

  // Через несколько секунд после загрузки, если стрим не воспроизводится,
  // подсказываем пользователю о возможной недоступности эфира.
  setTimeout(() => {
    if (currentStreamIndex < STREAMS.length) {
      videoFallback.classList.remove("hidden");
      videoFallback.querySelector("p").innerHTML =
        "📡 Эфир может быть временно недоступен.<br /><u>Нажмите, чтобы попробовать другой канал</u>";
    }
  }, 12000);
}

function switchToNextStream() {
  currentStreamIndex += 1;
  if (currentStreamIndex >= STREAMS.length) currentStreamIndex = 0;
  const stream = STREAMS[currentStreamIndex];
  cameraFrame.src = buildEmbedSrc(stream.id);
  cameraFrame.title = `${stream.title} — live`;
  videoFallback.classList.add("hidden");
}

/* ------------------------------ Init ------------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  startClock();       // 1. Часы (обновление каждую секунду)
  loadWeather();      // 2. Погода (fetch при загрузке страницы)
  setupCamera();      // 3. Камера (iframe уже в разметке)

  // Автообновление погоды
  setInterval(loadWeather, WEATHER_REFRESH_MS);

  // Кнопки погоды
  el("w-refresh").addEventListener("click", loadWeather);
  el("w-retry").addEventListener("click", loadWeather);
});
