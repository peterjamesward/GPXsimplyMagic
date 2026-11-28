export const buildingGroundEmbedDepthMeters = 2;

export const getBuildingGroundBaseY = (groundY: number, sceneUnitsPerMeter: number): number =>
  groundY - buildingGroundEmbedDepthMeters * sceneUnitsPerMeter * 2;