export const terrainSourceOptions = Object.freeze({
  type: "raster-dem" as const,
  tiles: Object.freeze(["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"]),
  tileSize: 256,
  maxzoom: 15,
  encoding: "terrarium" as const,
  attribution: "AWS Terrain Tiles (Mapzen; data sources vary by region)",
});