/**
 * ISO 3166-1 alpha-2 country codes, for the one place availability is regional.
 *
 * Availability data comes from TMDB via JustWatch and is scoped to a country: a
 * title can be streamable in the US and absent from Brazil. Both the staff
 * console and the public title page need to name that country in plain language,
 * so the labels live in one place instead of drifting between components.
 *
 * This is a shortlist, not the full ISO list. The Worker accepts any two-letter
 * code and falls back to US; an unrecognised code is displayed as the code
 * itself rather than being mislabelled.
 */
export const REGION_NAMES = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  IE: 'Ireland',
  DE: 'Germany',
  FR: 'France',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  BR: 'Brazil',
  MX: 'Mexico',
  AR: 'Argentina',
  IN: 'India',
  JP: 'Japan',
  KR: 'South Korea',
  SG: 'Singapore',
  MY: 'Malaysia',
  PH: 'Philippines',
  ID: 'Indonesia',
  TH: 'Thailand',
  VN: 'Vietnam',
  ZA: 'South Africa',
  NG: 'Nigeria',
  AE: 'UAE',
  SA: 'Saudi Arabia',
  PL: 'Poland',
};

/** Human label for a code, falling back to the code when unknown. */
export function regionName(code) {
  if (!code) return null;
  return REGION_NAMES[code] ?? code;
}

/** Codes offered in the staff console, US first as the fallback default. */
export const REGION_OPTIONS = ['US', 'GB', 'CA', 'AU', 'IE', 'DE', 'FR', 'IN', 'BR', 'JP'];