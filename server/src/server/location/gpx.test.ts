// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseGpxPoints } from "./gpx.js";

describe("parseGpxPoints", () => {
  it("extracts lat/lon from trkpt/wpt/rtept tags (self-closing or with children)", () => {
    const xml = `
      <gpx>
        <trk><trkseg>
          <trkpt lat="35.04974" lon="-89.69605"><ele>110</ele></trkpt>
          <trkpt lat="36.0589" lon="-86.7135"/>
        </trkseg></trk>
        <wpt lat="36.1627" lon="-86.7816"></wpt>
        <rte><rtept lat="25.0" lon="-45.0"/></rte>
      </gpx>`;
    expect(parseGpxPoints(xml)).toEqual([
      { lat: 35.04974, lon: -89.69605 },
      { lat: 36.0589, lon: -86.7135 },
      { lat: 36.1627, lon: -86.7816 },
      { lat: 25.0, lon: -45.0 },
    ]);
  });

  it("tolerates attribute order and whitespace, ignores non-point tags", () => {
    const xml = `<trkpt  lon = "-86.5"  lat="36.5" ><time>x</time></trkpt><name lat="0" lon="0"/>`;
    // <name> is not a point tag -> ignored; lon-before-lat still parses.
    expect(parseGpxPoints(xml)).toEqual([{ lat: 36.5, lon: -86.5 }]);
  });

  it("returns [] for a GPX with no points", () => {
    expect(parseGpxPoints("<gpx><trk><trkseg></trkseg></trk></gpx>")).toEqual([]);
  });
});
