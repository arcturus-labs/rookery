// @vitest-environment node
import { describe, expect, it } from "vitest";
import { haversineMeters, pointInPolygon } from "./geo.js";

describe("geo", () => {
  it("computes haversine distance", () => {
    // ~1 deg latitude ~= 111km.
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(110000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(112000);
    expect(haversineMeters(36.1627, -86.7816, 36.1627, -86.7816)).toBe(0);
  });

  it("tests point-in-polygon ([lon, lat] order)", () => {
    const square = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    expect(pointInPolygon(0, 0, square)).toBe(true); // lat=0, lon=0 inside
    expect(pointInPolygon(2, 0, square)).toBe(false); // lat=2 outside
    expect(pointInPolygon(0, 2, square)).toBe(false); // lon=2 outside
  });
});
