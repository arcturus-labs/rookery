import { bestGuessStoreNumber } from "./storeNumber.js";

/** Decimal places for the lat/lng fallback key (~1m precision). */
const GEO_PRECISION = 5;
const MAX_SLUG_LENGTH = 80;

export interface LocationKeyInput {
  domain: string;
  /** Authoritative store number from the provider, if any (takes top precedence). */
  storeNumber?: string;
  website?: string;
  address?: string;
  /** Two-letter state code, e.g. "TN". */
  stateAbbrev?: string;
  zip?: string;
  latitude: number;
  longitude: number;
  /** Centroid of the matched building, preferred over the point for the geo key. */
  buildingCentroidLat?: number;
  buildingCentroidLon?: number;
}

export interface LocationKey {
  /** Path component for the environment id (after `loc:<domain>/`). */
  key: string;
  kind: "store" | "address" | "geo";
  /** Present only when kind === "store". */
  storeNumber?: string;
}

/** Lowercase, collapse non-alphanumerics to single dashes, trim, length-cap. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Builds a stable, per-location key for a business, with precedence:
 *   1. numeric store id parsed from the website (`store-<n>`),
 *   2. generated `state-zip-street` address slug,
 *   3. a rounded `lat,lng` when no address is known — the matched building's
 *      centroid if the point is inside a building, else the business point.
 */
export function locationKey(input: LocationKeyInput): LocationKey {
  // Authoritative provider store number wins; else guess from the website URL.
  const storeNumber = input.storeNumber ?? bestGuessStoreNumber(input.website, input.domain) ?? undefined;
  if (storeNumber) {
    return { key: `store-${storeNumber}`, kind: "store", storeNumber };
  }

  const street = input.address ? slugify(input.address) : "";
  if (street) {
    const parts = [input.stateAbbrev, input.zip, input.address]
      .map((p) => (p ? slugify(p) : ""))
      .filter(Boolean);
    return { key: parts.join("-"), kind: "address" };
  }

  const geoLat = input.buildingCentroidLat ?? input.latitude;
  const geoLon = input.buildingCentroidLon ?? input.longitude;
  return { key: `${geoLat.toFixed(GEO_PRECISION)},${geoLon.toFixed(GEO_PRECISION)}`, kind: "geo" };
}
