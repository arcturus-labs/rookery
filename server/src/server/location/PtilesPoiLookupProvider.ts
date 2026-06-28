import { AdminReader } from "./ptiles/AdminReader.js";
import { queryBuilding, type BuildingMatch } from "./ptiles/BuildingsReader.js";
import { queryBusinesses } from "./ptiles/BusinessReader.js";
import { PtilesRangeSource, type FetchRange } from "./ptiles/PtilesRangeSource.js";
import { matchReason, scoreBusinesses, type ScoredBusiness } from "./ptiles/scoring.js";
import { stateAbbrev } from "./ptiles/usStates.js";
import type { PoiLookupInput, PoiLookupProvider, PoiResult } from "./PoiLookupProvider.js";

/** Max candidates returned (the demo shows up to 40; environments need far fewer). */
const MAX_CANDIDATES = 12;
/** Default business search radius (km), matching the demo's GPS lookup. */
const DEFAULT_RADIUS_KM = 0.2;

export interface PtilesPoiLookupProviderOptions {
  /** Range fetcher wired to the in-process proxy route. */
  fetchRange: FetchRange;
  adminFile?: string;
  maxCandidates?: number;
}

/**
 * Real POI provider replicating the steele.red/ptiles lat/lng -> building +
 * business matching, server-side. Resolves the state via US.admin.ptiles, then
 * queries that state's buildings + business layers (range-fetched through the
 * proxy route) and applies the demo's inside-building / name-match / nearby
 * scoring before mapping to {@link PoiResult}s.
 */
export class PtilesPoiLookupProvider implements PoiLookupProvider {
  private readonly fetchRange: FetchRange;
  private readonly adminFile: string;
  private readonly maxCandidates: number;
  private adminReader?: AdminReader;
  private readonly stateSources = new Map<string, { buildings: PtilesRangeSource; business: PtilesRangeSource }>();

  constructor(options: PtilesPoiLookupProviderOptions) {
    this.fetchRange = options.fetchRange;
    this.adminFile = options.adminFile ?? "US.admin.ptiles";
    this.maxCandidates = options.maxCandidates ?? MAX_CANDIDATES;
  }

  async nearbyPois(input: PoiLookupInput): Promise<PoiResult[]> {
    const { latitude, longitude } = input;
    const radiusKm = input.radiusMeters ? input.radiusMeters / 1000 : DEFAULT_RADIUS_KM;

    const admin = await this.getAdminReader().query(latitude, longitude);
    const abbrev = stateAbbrev(admin?.state);
    if (!abbrev) return []; // outside US coverage / ocean

    const { buildings, business } = await this.getStateSources(abbrev);
    const [building, businesses] = await Promise.all([
      queryBuilding(buildings, latitude, longitude),
      queryBusinesses(business, latitude, longitude, radiusKm),
    ]);
    if (businesses.length === 0) return [];

    const scored = scoreBusinesses(businesses, building);
    return scored.slice(0, this.maxCandidates).map((s) => this.toPoiResult(s, building, admin));
  }

  private toPoiResult(s: ScoredBusiness, building: BuildingMatch | null, admin: { county?: string; zip?: string } | null): PoiResult {
    const biz = s.biz;
    const matchReasons = [matchReason(s)];
    return {
      name: biz.name,
      operator: biz.brand || biz.name,
      ...(biz.address ? { address: biz.address } : {}),
      latitude: biz.lat,
      longitude: biz.lon,
      distanceMeters: biz.distance,
      matchReasons,
      raw: {
        category: biz.category,
        phone: biz.phone || undefined,
        website: biz.website || undefined,
        chainCount: biz.chainCount,
        county: admin?.county,
        zip: admin?.zip,
        buildingOsmId: building?.osmId,
        buildingName: building?.name ?? undefined,
        buildingType: building?.buildingType,
      },
    };
  }

  private getAdminReader(): AdminReader {
    if (!this.adminReader) {
      this.adminReader = new AdminReader(new PtilesRangeSource(this.adminFile, this.fetchRange));
    }
    return this.adminReader;
  }

  private async getStateSources(abbrev: string): Promise<{ buildings: PtilesRangeSource; business: PtilesRangeSource }> {
    let sources = this.stateSources.get(abbrev);
    if (!sources) {
      const buildings = new PtilesRangeSource(`${abbrev}.buildings_v8.ptiles`, this.fetchRange);
      const business = new PtilesRangeSource(`${abbrev}.business.ptiles`, this.fetchRange);
      await Promise.all([buildings.init(), business.init()]);
      sources = { buildings, business };
      this.stateSources.set(abbrev, sources);
    }
    return sources;
  }
}
