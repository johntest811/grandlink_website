import { parseAddressLine } from "./addressFields";

type AddressLike = {
  province?: string | null;
  city?: string | null;
  label?: string | null;
  address?: string | null;
  full_address?: string | null;
};

type LocationDropdownOptions = {
  provinceOptions: string[];
  cityOptions: string[];
  barangayOptions: string[];
};

const DEFAULT_CITIES_BY_PROVINCE: Record<string, string[]> = {
  "Metro Manila": [
    "Caloocan",
    "Las Pinas",
    "Makati",
    "Malabon",
    "Mandaluyong",
    "Manila",
    "Marikina",
    "Muntinlupa",
    "Navotas",
    "Paranaque",
    "Pasay",
    "Pasig",
    "Pateros",
    "Quezon City",
    "San Juan",
    "Taguig",
    "Valenzuela",
  ],
  "Bulacan": ["Bocaue", "Meycauayan", "Marilao", "Malolos", "San Jose del Monte"],
  "Cavite": ["Bacoor", "Cavite City", "Dasmarinas", "General Trias", "Imus", "Tagaytay"],
  "Laguna": ["Binan", "Calamba", "San Pablo", "San Pedro", "Santa Rosa"],
  "Pampanga": ["Angeles", "Mabalacat", "San Fernando"],
  "Batangas": ["Batangas City", "Lipa", "Santo Tomas", "Tanauan"],
  "Cebu": ["Cebu City", "Lapu-Lapu City", "Mandaue City", "Talisay"],
  "Davao del Sur": ["Davao City"],
  "Iloilo": ["Iloilo City", "Passi"],
  "Rizal": ["Antipolo", "Cainta", "Taytay"],
};

const DEFAULT_BARANGAYS_BY_CITY: Record<string, string[]> = {
  "Quezon City": ["Batasan Hills", "Commonwealth", "Tandang Sora", "Novaliches"],
  "Manila": ["Barangay 659", "Ermita", "Malate", "Sampaloc"],
  "Makati": ["Bel-Air", "Poblacion", "San Lorenzo", "Urdaneta"],
  "Taguig": ["Fort Bonifacio", "Pinagsama", "Ususan", "West Rembo"],
  "Pasig": ["Kapitolyo", "Manggahan", "Rosario", "San Antonio"],
  "Caloocan": ["Bagong Silang", "Grace Park", "Kalookan North", "Talipapa"],
  "Las Pinas": ["Almanza Uno", "Pulang Lupa", "Talon Uno", "Zapote"],
  "Paranaque": ["Baclaran", "BF Homes", "Don Bosco", "San Dionisio"],
  "Cebu City": ["Lahug", "Mabolo", "Talamban", "Tisa"],
  "Davao City": ["Buhangin", "Matina", "Poblacion", "Toril"],
  "Imus": ["Alapan", "Anabu", "Buhay na Tubig", "Malagasang"],
  "San Fernando": ["Del Pilar", "Lourdes", "San Agustin", "Santo Nino"],
};

const normalize = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const uniqueSorted = (values: (string | null | undefined)[]) =>
  Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

const matchCanonical = (query: string, options: string[]) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;
  return options.find((option) => normalize(option) === normalizedQuery) || null;
};

const filterByQuery = (options: string[], query: string, max = 60) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return options.slice(0, max);
  return options
    .filter((option) => normalize(option).includes(normalizedQuery))
    .slice(0, max);
};

const getBarangayFromAddress = (address: AddressLike) => {
  if (address.label?.trim()) return address.label.trim();
  const parsed = parseAddressLine(String(address.full_address || address.address || ""));
  return parsed.barangay.trim();
};

export const getLocationDropdownOptions = (
  addresses: AddressLike[],
  selectedProvince: string,
  selectedCity: string,
  selectedBarangay = ""
): LocationDropdownOptions => {
  const defaultProvinces = Object.keys(DEFAULT_CITIES_BY_PROVINCE);
  const provinceOptions = uniqueSorted([
    ...defaultProvinces,
    ...addresses.map((addr) => addr.province),
  ]);

  const canonicalProvince = matchCanonical(selectedProvince, provinceOptions);

  const defaultCities = canonicalProvince
    ? DEFAULT_CITIES_BY_PROVINCE[canonicalProvince] || []
    : Object.values(DEFAULT_CITIES_BY_PROVINCE).flat();

  const cityOptions = uniqueSorted([
    ...defaultCities,
    ...addresses
      .filter((addr) => {
        if (!canonicalProvince) return true;
        return normalize(addr.province) === normalize(canonicalProvince);
      })
      .map((addr) => addr.city),
  ]);

  const canonicalCity = matchCanonical(selectedCity, cityOptions);
  const defaultBarangays = canonicalCity ? DEFAULT_BARANGAYS_BY_CITY[canonicalCity] || [] : [];

  const barangayOptions = uniqueSorted([
    ...defaultBarangays,
    ...addresses
      .filter((addr) => {
        if (canonicalProvince && normalize(addr.province) !== normalize(canonicalProvince)) {
          return false;
        }
        if (canonicalCity && normalize(addr.city) !== normalize(canonicalCity)) {
          return false;
        }
        return true;
      })
      .map(getBarangayFromAddress),
  ]);

  return {
    provinceOptions: filterByQuery(provinceOptions, selectedProvince),
    cityOptions: filterByQuery(cityOptions, selectedCity),
    barangayOptions: filterByQuery(barangayOptions, selectedBarangay),
  };
};
