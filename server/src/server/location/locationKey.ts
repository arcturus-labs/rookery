import { latLngToCell } from "h3-js";
import { bestGuessStoreNumber } from "./storeNumber.js";

/** H3 resolution for the no-address fallback key (~residential-building scale). */
const H3_FALLBACK_RES = 13;
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
}

export interface LocationKey {
  /** Path component for the environment id (after `loc:<domain>/`). */
  key: string;
  kind: "store" | "address" | "h3";
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
 *   3. H3 cell of the coordinate (`h3-<cell>`) when no address is known.
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

  return { key: `h3-${latLngToCell(input.latitude, input.longitude, H3_FALLBACK_RES)}`, kind: "h3" };
}
