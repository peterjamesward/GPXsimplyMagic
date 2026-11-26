// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { getTrackSummary, parseGpx } from "../src/gpx";

describe("parseGpx", () => {
  it("parses namespaced track points and returns immutable track data", () => {
    const track = parseGpx(`
      <gpx xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>Alpine Loop</name><trkseg>
          <trkpt lat="46.8" lon="9.5"><ele>1200</ele></trkpt>
          <trkpt lat="46.81" lon="9.52"><ele>1280</ele></trkpt>
        </trkseg></trk>
      </gpx>
    `);

    expect(track.name).toBe("Alpine Loop");
    expect(track.points).toEqual([
      { latitude: 46.8, longitude: 9.5, elevationMeters: 1200 },
      { latitude: 46.81, longitude: 9.52, elevationMeters: 1280 },
    ]);
    expect(Object.isFrozen(track)).toBe(true);
    expect(Object.isFrozen(track.points)).toBe(true);
    expect(Object.isFrozen(track.points[0])).toBe(true);
  });

  it("defaults missing elevations to zero", () => {
    const track = parseGpx(`<gpx><trk><trkseg>
      <trkpt lat="1" lon="2"/><trkpt lat="1.01" lon="2.01"/>
    </trkseg></trk></gpx>`);

    expect(track.points.map((point) => point.elevationMeters)).toEqual([0, 0]);
  });

  it.each([
    ["empty input", "", "empty"],
    ["malformed XML", "<gpx><trk>", "valid GPX XML"],
    ["wrong root", "<route />", "GPX root"],
    ["too few points", "<gpx><trk><trkseg><trkpt lat='1' lon='2'/></trkseg></trk></gpx>", "at least two"],
    ["invalid latitude", "<gpx><trk><trkseg><trkpt lat='91' lon='2'/><trkpt lat='1' lon='2'/></trkseg></trk></gpx>", "invalid latitude"],
    ["invalid elevation", "<gpx><trk><trkseg><trkpt lat='1' lon='2'><ele>high</ele></trkpt><trkpt lat='1' lon='2'/></trkseg></trk></gpx>", "invalid elevation"],
  ])("rejects %s", (_description, xml, error) => {
    expect(() => parseGpx(xml)).toThrow(error);
  });
});

describe("getTrackSummary", () => {
  it("calculates route distance and cumulative uphill elevation", () => {
    const track = parseGpx(`<gpx><trk><trkseg>
      <trkpt lat="0" lon="0"><ele>100</ele></trkpt>
      <trkpt lat="0" lon="0.01"><ele>150</ele></trkpt>
      <trkpt lat="0" lon="0.02"><ele>120</ele></trkpt>
    </trkseg></trk></gpx>`);

    const summary = getTrackSummary(track.points);

    expect(summary.distanceKm).toBeCloseTo(2.2239, 3);
    expect(summary.elevationGainMeters).toBe(50);
  });

  it("uses the 2-degree short arc for routes crossing the international date line", () => {
    const track = parseGpx(`<gpx><trk><trkseg>
      <trkpt lat="0" lon="-179"/><trkpt lat="0" lon="179"/>
    </trkseg></trk></gpx>`);

    expect(getTrackSummary(track.points).distanceKm).toBeCloseTo(222.39, 1);
  });
});