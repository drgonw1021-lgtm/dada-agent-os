import type { ToolDefinition, ToolContext } from "../../core/types.js";

interface WeatherInput {
  city?: string;
  lat?: number;
  lon?: number;
  days?: number;
}

interface DailyForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  weatherCode: number;
  weatherDesc: string;
}

interface WeatherOutput {
  success: boolean;
  location: string;
  current?: {
    temperature: number;
    windspeed: number;
    winddirection: number;
    weatherCode: number;
    weatherDesc: string;
    isDay: boolean;
  };
  daily?: DailyForecast[];
  error?: string;
}

// WMO weather codes -> description
const WMO_CODES: Record<number, string> = {
  0: "晴天", 1: "大部晴朗", 2: "多云", 3: "阴天",
  45: "雾", 48: "雾凇",
  51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  71: "小雪", 73: "中雪", 75: "大雪",
  80: "阵雨", 81: "中阵雨", 82: "大阵雨",
  85: "小阵雪", 86: "大阵雪",
  95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹",
};

// City name -> lat/lon lookup
const CITY_COORDS: Record<string, [number, number]> = {
  "北京": [39.91, 116.40], "上海": [31.23, 121.47], "广州": [23.13, 113.26],
  "深圳": [22.54, 114.06], "杭州": [30.29, 120.15], "成都": [30.57, 104.07],
  "武汉": [30.59, 114.31], "南京": [32.06, 118.80], "西安": [34.26, 108.94],
  "重庆": [29.56, 106.55], "天津": [39.12, 117.18], "苏州": [31.30, 120.62],
  "长沙": [28.23, 112.94], "郑州": [34.75, 113.63], "青岛": [36.07, 120.38],
  "大连": [38.91, 121.61], "厦门": [24.48, 118.09], "福州": [26.07, 119.30],
  "合肥": [31.82, 117.23], "济南": [36.65, 117.00], "沈阳": [41.80, 123.43],
  "昆明": [25.04, 102.71], "贵阳": [26.65, 106.63], "南宁": [22.82, 108.37],
  "香港": [22.32, 114.17], "台北": [25.03, 121.57], "澳门": [22.20, 113.54],
  "东京": [35.68, 139.76], "首尔": [37.57, 126.98], "新加坡": [1.35, 103.82],
  "纽约": [40.71, -74.01], "伦敦": [51.51, -0.13], "巴黎": [48.86, 2.35],
  "柏林": [52.52, 13.41], "悉尼": [-33.87, 151.21], "莫斯科": [55.75, 37.62],
  "beijing": [39.91, 116.40], "shanghai": [31.23, 121.47], "guangzhou": [23.13, 113.26],
  "shenzhen": [22.54, 114.06], "hangzhou": [30.29, 120.15], "chengdu": [30.57, 104.07],
  "wuhan": [30.59, 114.31], "nanjing": [32.06, 118.80], "xian": [34.26, 108.94],
  "tokyo": [35.68, 139.76], "seoul": [37.57, 126.98], "singapore": [1.35, 103.82],
  "new york": [40.71, -74.01], "london": [51.51, -0.13], "paris": [48.86, 2.35],
  "berlin": [52.52, 13.41], "sydney": [-33.87, 151.21], "moscow": [55.75, 37.62],
};

function lookupCoords(city: string): [number, number] | null {
  return CITY_COORDS[city] || CITY_COORDS[city.toLowerCase()] || null;
}

export function createWeatherTool(): ToolDefinition<WeatherInput, WeatherOutput> {
  return {
    id: "weather",
    description: "Get current weather and 3-day forecast for any city worldwide. Uses Open-Meteo free API, no key required. Supports Chinese and English city names for 30+ major cities.",
    requiredScopes: ["web.fetch"],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name in Chinese or English, e.g. '上海', 'tokyo', 'new york'. Or use lat/lon directly." },
        lat: { type: "number", description: "Latitude (if city not in lookup table)" },
        lon: { type: "number", description: "Longitude (if city not in lookup table)" },
        days: { type: "number", description: "Forecast days (1-7, default 3)" }
      },
      required: []
    },
    async execute(input: WeatherInput, _ctx: ToolContext): Promise<WeatherOutput> {
      let lat: number, lon: number, label: string;
      const days = Math.min(input.days || 3, 7);

      if (input.city) {
        const coords = lookupCoords(input.city);
        if (coords) {
          [lat, lon] = coords;
          label = input.city;
        } else {
          return { success: false, location: input.city, error: `Unknown city: "${input.city}". Use lat/lon directly, or try a major city name.` };
        }
      } else if (input.lat != null && input.lon != null) {
        lat = input.lat;
        lon = input.lon;
        label = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      } else {
        return { success: false, location: "unknown", error: "Provide either 'city' or both 'lat' and 'lon'." };
      }

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto&forecast_days=${days}`;
        const resp = await fetch(url, {
          headers: { "User-Agent": "DaDa/1.0" },
          signal: AbortSignal.timeout(10000)
        });
        if (!resp.ok) {
          return { success: false, location: label, error: `Open-Meteo ${resp.status}: ${(await resp.text().catch(()=>"")).slice(0, 100)}` };
        }
        const data = await resp.json() as any;

        const cw = data.current_weather;
        const daily: DailyForecast[] = (data.daily?.time || []).map((t: string, i: number) => ({
          date: t,
          tempMax: data.daily.temperature_2m_max[i],
          tempMin: data.daily.temperature_2m_min[i],
          precipitation: data.daily.precipitation_sum[i],
          weatherCode: data.daily.weathercode[i],
          weatherDesc: WMO_CODES[data.daily.weathercode[i]] || "未知",
        }));

        console.log(`[weather] ${label}: ${cw.temperature}°C, ${WMO_CODES[cw.weathercode]||"?"}, forecast ${daily.length} days`);
        return {
          success: true,
          location: label,
          current: {
            temperature: cw.temperature,
            windspeed: cw.windspeed,
            winddirection: cw.winddirection,
            weatherCode: cw.weathercode,
            weatherDesc: WMO_CODES[cw.weathercode] || "未知",
            isDay: !!cw.is_day,
          },
          daily
        };
      } catch (err) {
        return { success: false, location: label, error: `Weather fetch failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  };
}
