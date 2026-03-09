export type WeatherKey = "sunny" | "rainy" | "night" | "foggy";
export type SkyboxKey = "default" | WeatherKey;

export const WEATHER_KEYS: WeatherKey[] = ["sunny", "rainy", "night", "foggy"];
export const SKYBOX_KEYS: SkyboxKey[] = ["default", ...WEATHER_KEYS];

export type SkyboxMap = Partial<Record<SkyboxKey, string | null>>;

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeSkyboxes(input: unknown): SkyboxMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const source = input as Record<string, unknown>;
  const next: SkyboxMap = {};

  SKYBOX_KEYS.forEach((key) => {
    const value = normalizeUrl(source[key]);
    if (value) next[key] = value;
  });

  return next;
}

export function mergeSkyboxes(productSkyboxes?: SkyboxMap | null, sharedDefaults?: SkyboxMap | null): SkyboxMap {
  const product = normalizeSkyboxes(productSkyboxes);
  const shared = normalizeSkyboxes(sharedDefaults);

  const next: SkyboxMap = {};
  const resolvedDefault = product.default || shared.default || null;
  if (resolvedDefault) {
    next.default = resolvedDefault;
  }

  WEATHER_KEYS.forEach((weather) => {
    const resolved = product[weather] || shared[weather] || null;
    if (resolved) {
      next[weather] = resolved;
    }
  });

  return next;
}
