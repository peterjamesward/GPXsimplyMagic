import { Map as MapLibreMap, NavigationControl, type GeoJSONSource } from "maplibre-gl";
import type { TrackPoint } from "./gpx";
import { getContinuousLongitudes } from "./trackGeometry";
import { terrainSourceOptions } from "./terrainSource";

const terrainSourceId = "route-terrain-dem";
const routeSourceId = "gpx-route";

const createRouteFeature = (points: readonly TrackPoint[]) => {
  const longitudes = getContinuousLongitudes(points);
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: points.map((point, index) => [longitudes[index], point.latitude]),
    },
  };
};

export const createTerrainMap = (container: HTMLElement, errorMessage: HTMLElement) => {
  const map = new MapLibreMap({
    container,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [0, 0],
    zoom: 2,
    pitch: 45,
    maxPitch: 85,
    minZoom: -2,
    maxZoom: 22,
  });
  map.addControl(new NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }));

  let styleLoaded = false;
  let pendingRoute: readonly TrackPoint[] = [];

  const updateRoute = (points: readonly TrackPoint[]): void => {
    const source = map.getSource(routeSourceId) as GeoJSONSource | undefined;
    if (source !== undefined) {
      void source.setData(createRouteFeature(points));
    }
  };

  map.once("load", () => {
    map.addSource(terrainSourceId, { ...terrainSourceOptions, tiles: [...terrainSourceOptions.tiles] });
    map.setTerrain({ source: terrainSourceId, exaggeration: 1 });
    map.addSource(routeSourceId, { type: "geojson", data: createRouteFeature(pendingRoute) });
    map.addLayer({
      id: "gpx-route-line",
      type: "line",
      source: routeSourceId,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#e45c38", "line-width": 4, "line-opacity": 0.96 },
    });
    styleLoaded = true;
  });
  map.on("error", () => {
    errorMessage.hidden = false;
  });
  map.on("load", () => {
    errorMessage.hidden = true;
  });

  return Object.freeze({
    map,
    setRoute: (points: readonly TrackPoint[]): void => {
      pendingRoute = points;
      if (styleLoaded) {
        updateRoute(points);
      }
    },
  });
};