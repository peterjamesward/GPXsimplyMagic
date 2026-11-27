import * as THREE from "three";
import { createRouteConstraintIndex } from "./routeConstraints";
import {
  createLandUseSpatialIndex,
  emptyOpenStreetMapFeatures,
  type LandUseCategory,
  type LandUseSpatialIndex,
  type OpenStreetMapBuilding,
  type OpenStreetMapFeatures,
} from "./openStreetMap";
import { createMappedRoadMeshData, type MappedRoadSurface } from "./mappedRoadGeometry";
import {
  advanceRideWindClock,
  createRideRoadMarkings,
  createRideWindClock,
  getRideTerrainChunkPlan,
  rideTerrainChunkSizeMeters,
  type RideCameraPose,
  type RideTerrainChunk,
} from "./riderScene";
import {
  createTerrainChunkMeshData,
  type TerrainMeshData,
} from "./terrainGeometry";
import type { TerrainDemData } from "./terrainDem";
import type { TrackMeshData, TrackMeshPart } from "./trackGeometry";
import {
  createStylizedGrassPlacements,
  getRideGrassPlacementTarget,
  getRideTreePlacementTarget,
  type StylizedTreePlacement,
} from "./vegetationPlacement";
import { createStylizedGrassMesh, createStylizedTreeGroup, loadStylizedVegetationAssets, updateStylizedVegetationWind, type StylizedVegetationAssets } from "./stylizedVegetation";

type TerrainChunkRecord = Readonly<{ group: THREE.Group; revision: number }>;
type PendingChunk = Readonly<{ descriptor: RideTerrainChunk; revision: number }>;

export type RideSceneRenderer = Readonly<{
  setRoute: (geometry: TrackMeshData) => void;
  setEnvironment: (elevation: TerrainDemData | null, features: OpenStreetMapFeatures) => void;
  setCameraPose: (pose: RideCameraPose) => void;
  setPlaybackPaused: (paused: boolean) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
}>;

const linearize = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const seedForChunk = (key: string): number => {
  let seed = 0x45d9f3b;
  for (let index = 0; index < key.length; index += 1) {
    seed = Math.imul(seed ^ key.charCodeAt(index), 0x45d9f3b);
  }
  return seed >>> 0;
};

const createPatternTexture = (category: LandUseCategory | null): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Unable to create the procedural ground texture.");
  }

  context.fillStyle = "#f4f3e8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const random = createRandom(seedForChunk(category ?? "grassland"));
  if (category === "farmland") {
    for (let row = -24; row < 540; row += 18) {
      context.beginPath();
      context.moveTo(-20, row);
      context.bezierCurveTo(120, row - 12, 340, row + 12, 532, row - 4);
      context.strokeStyle = row % 36 === 0 ? "rgba(73, 57, 34, 0.31)" : "rgba(255, 246, 190, 0.24)";
      context.lineWidth = row % 36 === 0 ? 3 : 2;
      context.stroke();
    }
  } else if (category === "woodland") {
    for (let index = 0; index < 550; index += 1) {
      const radius = 4 + random() * 18;
      context.beginPath();
      context.ellipse(random() * 512, random() * 512, radius, radius * (0.45 + random() * 0.8), random() * Math.PI, 0, Math.PI * 2);
      context.fillStyle = random() > 0.48 ? "rgba(28, 72, 39, 0.2)" : "rgba(179, 176, 100, 0.14)";
      context.fill();
    }
  } else if (category === "water") {
    for (let row = 10; row < 520; row += 22) {
      context.beginPath();
      context.moveTo(-8, row);
      context.bezierCurveTo(125, row - 9, 255, row + 8, 520, row - 3);
      context.strokeStyle = "rgba(214, 237, 232, 0.42)";
      context.lineWidth = 2;
      context.stroke();
    }
  } else if (category === "residential" || category === "industrial") {
    for (let index = 0; index < 75; index += 1) {
      const size = 6 + random() * 27;
      context.fillStyle = "rgba(69, 66, 58, 0.12)";
      context.fillRect(random() * 512, random() * 512, size, size * (0.55 + random() * 0.8));
    }
  } else {
    for (let index = 0; index < 1_100; index += 1) {
      context.beginPath();
      context.arc(random() * 512, random() * 512, 1 + random() * 5, 0, Math.PI * 2);
      context.fillStyle = random() > 0.5 ? "rgba(62, 82, 45, 0.13)" : "rgba(244, 241, 202, 0.22)";
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
};

const createAsphaltTextures = (): Readonly<{ color: THREE.CanvasTexture; normal: THREE.DataTexture }> => {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Unable to create the road surface texture.");
  }

  context.fillStyle = "#44494b";
  context.fillRect(0, 0, 512, 512);
  const random = createRandom(0x33a57);
  for (let index = 0; index < 7_000; index += 1) {
    const radius = 0.3 + random() * 1.5;
    context.beginPath();
    context.arc(random() * 512, random() * 512, radius, 0, Math.PI * 2);
    context.fillStyle = random() > 0.5 ? "rgba(220, 224, 221, 0.18)" : "rgba(8, 11, 12, 0.2)";
    context.fill();
  }
  const color = new THREE.CanvasTexture(canvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = THREE.RepeatWrapping;
  color.wrapT = THREE.RepeatWrapping;
  color.anisotropy = 8;

  const side = 128;
  const pixels = new Uint8Array(side * side * 4);
  for (let index = 0; index < side * side; index += 1) {
    const offset = index * 4;
    pixels[offset] = 116 + Math.round(random() * 22);
    pixels[offset + 1] = 116 + Math.round(random() * 22);
    pixels[offset + 2] = 250;
    pixels[offset + 3] = 255;
  }
  const normal = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat);
  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.RepeatWrapping;
  normal.needsUpdate = true;
  return Object.freeze({ color, normal });
};

const createSkyMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    sunDirection: { value: new THREE.Vector3(-0.45, 0.7, -0.55).normalize() },
    horizonColor: { value: new THREE.Color("#c8d6d4") },
    zenithColor: { value: new THREE.Color("#4a7898") },
    sunColor: { value: new THREE.Color("#fff0c2") },
  },
  vertexShader: `
    varying vec3 vSkyDirection;
    void main() {
      vSkyDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vSkyDirection;
    uniform vec3 sunDirection;
    uniform vec3 horizonColor;
    uniform vec3 zenithColor;
    uniform vec3 sunColor;
    void main() {
      vec3 direction = normalize(vSkyDirection);
      float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
      float gradient = smoothstep(0.08, 0.92, height);
      vec3 sky = mix(horizonColor, zenithColor, gradient);
      float sunDot = max(dot(direction, normalize(sunDirection)), 0.0);
      float halo = pow(sunDot, 16.0) * 0.16;
      float disc = smoothstep(0.9991, 0.99975, sunDot);
      sky = mix(sky, sunColor, clamp(halo + disc, 0.0, 1.0));
      float horizonHaze = (1.0 - smoothstep(-0.04, 0.35, direction.y)) * 0.16;
      sky = mix(sky, horizonColor, horizonHaze);
      gl_FragColor = vec4(sky, 1.0);
    }
  `,
});

const addTerrainShaderDetail = (material: THREE.MeshStandardMaterial): void => {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vRideTerrainPosition;",
    ).replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvRideTerrainPosition = position;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vRideTerrainPosition;\nfloat rideHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    ).replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       float fineNoise = rideHash(floor(vRideTerrainPosition.xz * 740.0));
       float broadNoise = rideHash(floor(vRideTerrainPosition.xz * 185.0));
       float terrainVariation = 0.91 + fineNoise * 0.12 + broadNoise * 0.08;
       diffuseColor.rgb *= terrainVariation;`,
    );
  };
  material.customProgramCacheKey = () => "ride-terrain-detail-v1";
};

const createPartGeometry = (
  part: TrackMeshPart,
  sceneUnitsPerMeter: number,
  colorsAsLinear = false,
): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(part.positions);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(part.normals), 3));
  geometry.setIndex(part.indices as number[]);
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let index = 0; index < positions.length; index += 3) {
    const uvIndex = (index / 3) * 2;
    uvs[uvIndex] = (positions[index] / sceneUnitsPerMeter) * 0.09;
    uvs[uvIndex + 1] = (positions[index + 2] / sceneUnitsPerMeter) * 0.09;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  if (part.colors !== undefined) {
    const colors = new Float32Array((positions.length / 3) * 3);
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = part.colors[vertex * 4 + channel] ?? 1;
        colors[vertex * 3 + channel] = colorsAsLinear ? linearize(value) : value;
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  geometry.computeBoundingSphere();
  return geometry;
};

const createTerrainGeometry = (terrain: TerrainMeshData, sceneUnitsPerMeter: number): THREE.BufferGeometry => {
  const positions = [...terrain.positions];
  const normals = [...terrain.normals];
  const colors = terrain.colors === undefined ? [] : [...terrain.colors];
  const indices = [...terrain.indices];
  const last = terrain.columns - 1;
  const perimeter: number[] = [];
  for (let column = 0; column <= last; column += 1) perimeter.push(column);
  for (let row = 1; row <= last; row += 1) perimeter.push(row * terrain.columns + last);
  for (let column = last - 1; column >= 0; column -= 1) perimeter.push(last * terrain.columns + column);
  for (let row = last - 1; row > 0; row -= 1) perimeter.push(row * terrain.columns);
  const skirtBottoms: number[] = [];
  perimeter.forEach((vertexIndex) => {
    const positionIndex = vertexIndex * 3;
    const bottomIndex = positions.length / 3;
    positions.push(positions[positionIndex], positions[positionIndex + 1] - 22 * sceneUnitsPerMeter, positions[positionIndex + 2]);
    normals.push(0, 1, 0);
    if (terrain.colors !== undefined) {
      const colorIndex = vertexIndex * 4;
      colors.push(colors[colorIndex], colors[colorIndex + 1], colors[colorIndex + 2], colors[colorIndex + 3]);
    }
    skirtBottoms.push(bottomIndex);
  });
  perimeter.forEach((topIndex, index) => {
    const next = (index + 1) % perimeter.length;
    const topNext = perimeter[next];
    const bottomIndex = skirtBottoms[index];
    const bottomNext = skirtBottoms[next];
    indices.push(topIndex, bottomIndex, topNext, topNext, bottomIndex, bottomNext);
  });

  const part: TrackMeshPart = Object.freeze({
    positions: Object.freeze(positions),
    normals: Object.freeze(normals),
    indices: Object.freeze(indices),
    ...(terrain.colors === undefined ? {} : { colors: Object.freeze(colors) }),
  });
  const geometry = createPartGeometry(part, sceneUnitsPerMeter, true);
  const vertexNormals = geometry.getAttribute("normal");
  for (let index = terrain.normals.length; index < normals.length; index += 3) {
    vertexNormals.setXYZ(index / 3, normals[index], normals[index + 1], normals[index + 2]);
  }
  return geometry;
};

const createGroundMaterial = (
  category: LandUseCategory | null,
  texture: THREE.CanvasTexture,
): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: "#ffffff",
    vertexColors: true,
    roughness: category === "water" ? 0.32 : 0.94,
    metalness: category === "water" ? 0.08 : 0,
    side: THREE.DoubleSide,
  });
  addTerrainShaderDetail(material);
  return material;
};

const createTreeGroup = (
  bounds: RideTerrainChunk["bounds"],
  terrain: TerrainMeshData,
  geometry: TrackMeshData,
  landUseIndex: LandUseSpatialIndex,
  chunk: RideTerrainChunk,
  seed: number,
  findRouteConstraints: ReturnType<typeof createRouteConstraintIndex>,
  stylizedAssets: StylizedVegetationAssets | null,
): THREE.Group => {
  const group = new THREE.Group();
  const random = createRandom(seed);
  const scale = geometry.projection.sceneUnitsPerMeter;
  const desired = getRideTreePlacementTarget(chunk.gridSize);
  const placements: Readonly<{ x: number; z: number; y: number; height: number; pine: boolean; rotation: number }>[] = [];
  const accepted: { x: number; z: number }[] = [];
  for (let attempt = 0; placements.length < desired && attempt < desired * 45; attempt += 1) {
    const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
    if (
      !landUseIndex.canPlaceTreeAt(x, z) ||
      findRouteConstraints(x, z, 0).nearest.distance < 7.5 * scale ||
      accepted.some((other) => Math.hypot(x - other.x, z - other.z) < 7 * scale)
    ) {
      continue;
    }
    const heightMeters = 8 + random() * 12;
    placements.push(Object.freeze({
      x,
      z,
      y: terrain.sampleHeightAt(x, z),
      height: heightMeters * scale * 2,
      pine: random() < 0.58,
      rotation: random() * Math.PI * 2,
    }));
    accepted.push({ x, z });
  }

  if (placements.length === 0) {
    return group;
  }

  if (stylizedAssets !== null) {
    const treePlacements: StylizedTreePlacement[] = placements.map((tree) => Object.freeze({
      x: tree.x,
      y: tree.y,
      z: tree.z,
      height: tree.height,
      rotation: tree.rotation,
    }));
    return createStylizedTreeGroup(stylizedAssets, treePlacements);
  }

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#594231", roughness: 0.92 });
  const trunkGeometry = new THREE.CylinderGeometry(0.075, 0.12, 1, 9, 2);
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, placements.length);
  const temporary = new THREE.Object3D();
  placements.forEach((tree, index) => {
    temporary.position.set(tree.x, tree.y + tree.height * 0.25, tree.z);
    temporary.rotation.set(0, tree.rotation, 0);
    temporary.scale.set(tree.height * 0.045, tree.height * 0.5, tree.height * 0.045);
    temporary.updateMatrix();
    trunks.setMatrixAt(index, temporary.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  group.add(trunks);

  const coneGeometry = new THREE.ConeGeometry(1, 1, 10, 3);
  const pineColors = ["#2e5a3d", "#376947", "#447751"];
  pineColors.forEach((color, tier) => {
    const pineTrees = placements.filter((tree) => tree.pine);
    if (pineTrees.length === 0) return;
    const foliage = new THREE.InstancedMesh(
      coneGeometry,
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.78, clearcoat: 0.08 }),
      pineTrees.length,
    );
    pineTrees.forEach((tree, index) => {
      const tierHeight = tree.height * [0.46, 0.38, 0.32][tier];
      const tierRadius = tree.height * [0.23, 0.18, 0.13][tier];
      temporary.position.set(tree.x, tree.y + tree.height * [0.34, 0.53, 0.7][tier], tree.z);
      temporary.rotation.set(0, tree.rotation, 0);
      temporary.scale.set(tierRadius, tierHeight, tierRadius);
      temporary.updateMatrix();
      foliage.setMatrixAt(index, temporary.matrix);
    });
    foliage.instanceMatrix.needsUpdate = true;
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    group.add(foliage);
  });

  const broadleafTrees = placements.filter((tree) => !tree.pine);
  if (broadleafTrees.length > 0) {
    const leafGeometry = new THREE.IcosahedronGeometry(1, 1);
    ["#487c4d", "#5c8c54", "#70985a", "#3e7048"].forEach((color, cluster) => {
      const leaves = new THREE.InstancedMesh(
        leafGeometry,
        new THREE.MeshPhysicalMaterial({ color, roughness: 0.82, clearcoat: 0.04 }),
        broadleafTrees.length,
      );
      broadleafTrees.forEach((tree, index) => {
        const phase = tree.rotation + cluster * Math.PI * 0.5;
        const offset = cluster === 0 ? 0 : tree.height * 0.12;
        temporary.position.set(
          tree.x + Math.cos(phase) * offset,
          tree.y + tree.height * (cluster === 0 ? 0.77 : 0.68 + (cluster % 2) * 0.08),
          tree.z + Math.sin(phase) * offset,
        );
        temporary.rotation.set(0.2 * Math.sin(phase), phase, 0.1 * Math.cos(phase));
        const radius = tree.height * (cluster === 0 ? 0.24 : 0.18);
        temporary.scale.set(radius * 1.1, radius * 0.86, radius);
        temporary.updateMatrix();
        leaves.setMatrixAt(index, temporary.matrix);
      });
      leaves.instanceMatrix.needsUpdate = true;
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      group.add(leaves);
    });
  }

  return group;
};

const getBuildingBounds = (building: OpenStreetMapBuilding): Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }> =>
  building.points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });

const createMappedBuildings = (
  chunk: RideTerrainChunk,
  terrain: TerrainMeshData,
  geometry: TrackMeshData,
  buildings: readonly OpenStreetMapBuilding[],
): THREE.Group => {
  const group = new THREE.Group();
  const scale = geometry.projection.sceneUnitsPerMeter;
  const windowMaterial = new THREE.MeshPhysicalMaterial({ color: "#405861", roughness: 0.25, metalness: 0.35, side: THREE.DoubleSide });
  const windowGeometry = new THREE.PlaneGeometry(0.72 * scale, 0.9 * scale);
  buildings.forEach((building) => {
    const footprint = building.points.slice(0, -1);
    if (footprint.length < 3) return;
    const bounds = getBuildingBounds(building);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    if (
      centerX < chunk.bounds.minX || centerX >= chunk.bounds.maxX ||
      centerZ < chunk.bounds.minZ || centerZ >= chunk.bounds.maxZ
    ) {
      return;
    }

    const shape = new THREE.Shape();
    footprint.forEach((point, index) => {
      const x = point.x - centerX;
      const z = point.z - centerZ;
      if (index === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const height = (building.heightMeters ?? 7) * scale * 2;
    const meshGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(height, 0.8 * scale),
      bevelEnabled: true,
      bevelSegments: 1,
      bevelThickness: 0.08 * scale,
      bevelSize: 0.08 * scale,
      curveSegments: 2,
    });
    meshGeometry.rotateX(-Math.PI / 2);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(...building.wallColor, THREE.SRGBColorSpace),
      roughness: 0.86,
      side: THREE.DoubleSide,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(...building.roofColor, THREE.SRGBColorSpace),
      roughness: 0.78,
      side: THREE.DoubleSide,
    });
    const buildingMesh = new THREE.Mesh(meshGeometry, [wallMaterial, roofMaterial]);
    const baseHeight = terrain.sampleHeightAt(centerX, centerZ);
    buildingMesh.position.set(centerX, baseHeight, centerZ);
    buildingMesh.castShadow = true;
    buildingMesh.receiveShadow = true;
    group.add(buildingMesh);

    const wallHeight = height * 0.74;
    footprint.forEach((point, index) => {
      const next = footprint[(index + 1) % footprint.length];
      const dx = next.x - point.x;
      const dz = next.z - point.z;
      const edgeLength = Math.hypot(dx, dz);
      const windowWidth = 0.72 * scale;
      if (edgeLength < windowWidth * 3) return;
      const count = Math.min(7, Math.floor(edgeLength / (1.8 * scale)));
      for (let windowIndex = 0; windowIndex < count; windowIndex += 1) {
        const progress = (windowIndex + 0.5) / count;
        const midpointX = point.x + dx * progress;
        const midpointZ = point.z + dz * progress;
        const outwardX = midpointX - centerX;
        const outwardZ = midpointZ - centerZ;
        const outwardLength = Math.hypot(outwardX, outwardZ) || 1;
        const window = new THREE.Mesh(windowGeometry, windowMaterial);
        window.position.set(
          midpointX + (outwardX / outwardLength) * 0.003 * scale,
          baseHeight + wallHeight * 0.58,
          midpointZ + (outwardZ / outwardLength) * 0.003 * scale,
        );
        window.rotation.y = Math.atan2(outwardX, outwardZ);
        window.castShadow = false;
        group.add(window);
      }
    });
  });
  return group;
};

const makeChunkGroup = (
  descriptor: RideTerrainChunk,
  revision: number,
  geometry: TrackMeshData,
  elevation: TerrainDemData | null,
  features: OpenStreetMapFeatures,
  materialForCategory: (category: LandUseCategory | null) => THREE.MeshStandardMaterial,
  materialForMappedRoad: (surface: MappedRoadSurface) => THREE.MeshStandardMaterial,
  index: LandUseSpatialIndex,
  findRouteConstraints: ReturnType<typeof createRouteConstraintIndex>,
  stylizedAssets: StylizedVegetationAssets | null,
): THREE.Group => {
  const sceneScale = geometry.projection.sceneUnitsPerMeter;
  const terrain = createTerrainChunkMeshData(
    geometry,
    elevation?.elevationAt ?? (() => null),
    descriptor.bounds,
    descriptor.gridSize,
    (x, z) => index.getColorAt(x, z) ?? [0.32, 0.44, 0.28],
    (rideTerrainChunkSizeMeters * Math.SQRT2) / 8,
  );
  const group = new THREE.Group();
  const centerX = (descriptor.bounds.minX + descriptor.bounds.maxX) / 2;
  const centerZ = (descriptor.bounds.minZ + descriptor.bounds.maxZ) / 2;
  const category = index.getCategoryAt(centerX, centerZ);
  const ground = new THREE.Mesh(createTerrainGeometry(terrain, sceneScale), materialForCategory(category));
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.frustumCulled = true;
  group.add(ground);
  createMappedRoadMeshData(features.roads, descriptor.bounds, sceneScale, terrain.sampleHeightAt).forEach(({ geometry: road, surface }) => {
    const roadMesh = new THREE.Mesh(createPartGeometry(road, sceneScale), materialForMappedRoad(surface));
    roadMesh.receiveShadow = true;
    group.add(roadMesh);
  });
  if (stylizedAssets !== null) {
    const grassPlacements = createStylizedGrassPlacements(
      terrain,
      geometry,
      index,
      seedForChunk(descriptor.key) ^ 0x71a55,
      getRideGrassPlacementTarget(descriptor.gridSize),
      descriptor.bounds,
      "area",
    );
    const grass = createStylizedGrassMesh(stylizedAssets, grassPlacements);
    if (grass !== null) group.add(grass);
  }
  group.add(createTreeGroup(
    descriptor.bounds,
    terrain,
    geometry,
    index,
    descriptor,
    seedForChunk(descriptor.key),
    findRouteConstraints,
    stylizedAssets,
  ));
  group.add(createMappedBuildings(descriptor, terrain, geometry, features.buildings));
  group.userData.terrainRevision = revision;
  return group;
};

export const createRideRenderer = (canvas: HTMLCanvasElement): RideSceneRenderer => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#aebfbd");
  const camera = new THREE.PerspectiveCamera(64, 1, 0.001, 1000);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), createSkyMaterial());
  sky.frustumCulled = false;
  scene.add(sky);

  const fillLight = new THREE.HemisphereLight("#d8e6e5", "#454638", 1.25);
  scene.add(fillLight);
  const sun = new THREE.DirectionalLight("#fff0d4", 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  const asphaltTextures = createAsphaltTextures();
  const roadMaterial = new THREE.MeshPhysicalMaterial({
    map: asphaltTextures.color,
    normalMap: asphaltTextures.normal,
    normalScale: new THREE.Vector2(0.22, 0.22),
    color: "#f4f4f2",
    roughness: 0.82,
    metalness: 0.025,
    clearcoat: 0.12,
    clearcoatRoughness: 0.72,
    side: THREE.DoubleSide,
  });
  const markingMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const patternTextures = new Map<LandUseCategory | null, THREE.CanvasTexture>();
  const groundMaterials = new Map<LandUseCategory | null, THREE.MeshStandardMaterial>();
  const mappedRoadMaterials = new Map<MappedRoadSurface, THREE.MeshStandardMaterial>();
  const materialForCategory = (category: LandUseCategory | null): THREE.MeshStandardMaterial => {
    let material = groundMaterials.get(category);
    if (material === undefined) {
      let texture = patternTextures.get(category);
      if (texture === undefined) {
        texture = createPatternTexture(category);
        patternTextures.set(category, texture);
      }
      material = createGroundMaterial(category, texture);
      groundMaterials.set(category, material);
    }
    return material;
  };
  const materialForMappedRoad = (surface: MappedRoadSurface): THREE.MeshStandardMaterial => {
    let material = mappedRoadMaterials.get(surface);
    if (material === undefined) {
      material = surface === "paved"
        ? new THREE.MeshStandardMaterial({
            map: asphaltTextures.color,
            normalMap: asphaltTextures.normal,
            normalScale: new THREE.Vector2(0.16, 0.16),
            roughness: 0.9,
            metalness: 0,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshStandardMaterial({ color: "#93836a", roughness: 0.98, side: THREE.DoubleSide });
      mappedRoadMaterials.set(surface, material);
    }
    return material;
  };

  let activeGeometry: TrackMeshData | null = null;
  let activeFeatures: OpenStreetMapFeatures = emptyOpenStreetMapFeatures;
  let activeElevation: TerrainDemData | null = null;
  let landUseIndex = createLandUseSpatialIndex(activeFeatures.areas);
  let routeIndex: ReturnType<typeof createRouteConstraintIndex> | null = null;
  let routeGroup: THREE.Group | null = null;
  let currentPose: RideCameraPose | null = null;
  let chunks = new Map<string, TerrainChunkRecord>();
  let wantedChunkKeys = new Set<string>();
  let pendingChunks: PendingChunk[] = [];
  let dataRevision = 0;
  let isActive = false;
  let playbackPaused = true;
  let animationFrame: number | null = null;
  let disposed = false;
  let lastTerrainPlan = "";
  let stylizedAssets: StylizedVegetationAssets | null = null;
  let windClock = createRideWindClock(performance.now() / 1000);

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement ?? canvas);

  const removeChunk = (key: string): void => {
    const record = chunks.get(key);
    if (record === undefined) return;
    scene.remove(record.group);
    record.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (
            material !== roadMaterial &&
            material !== markingMaterial &&
            ![...groundMaterials.values(), ...mappedRoadMaterials.values()].includes(material as THREE.MeshStandardMaterial)
          ) {
            material.dispose();
          }
        });
      }
    });
    chunks.delete(key);
  };

  const syncChunks = (): void => {
    if (activeGeometry === null || currentPose === null || routeIndex === null) return;
    const direction = {
      x: currentPose.target.x - currentPose.position.x,
      z: currentPose.target.z - currentPose.position.z,
    };
    const plan = getRideTerrainChunkPlan(
      currentPose.position,
      direction,
      activeGeometry.projection.sceneUnitsPerMeter,
    );
    const planKey = plan.map(({ key, gridSize }) => `${key}@${gridSize}`).join("|");
    if (planKey === lastTerrainPlan && pendingChunks.length === 0) return;
    lastTerrainPlan = planKey;
    wantedChunkKeys = new Set(plan.map(({ key }) => key));
    chunks.forEach((_record, key) => {
      if (!wantedChunkKeys.has(key)) removeChunk(key);
    });
    pendingChunks = plan
      .filter((descriptor) => chunks.get(descriptor.key)?.revision !== dataRevision)
      .map((descriptor) => Object.freeze({ descriptor, revision: dataRevision }));
  };

  void loadStylizedVegetationAssets().then((assets) => {
    if (disposed) {
      assets.dispose();
      return;
    }
    stylizedAssets = assets;
    dataRevision += 1;
    lastTerrainPlan = "";
    syncChunks();
  }).catch((error: unknown) => {
    console.warn("Unable to load stylized vegetation; using procedural scenery instead.", error);
  });

  const buildOnePendingChunk = (): void => {
    if (activeGeometry === null || routeIndex === null) return;
    while (pendingChunks.length > 0) {
      const pending = pendingChunks.shift();
      if (
        pending === undefined ||
        pending.revision !== dataRevision ||
        !wantedChunkKeys.has(pending.descriptor.key)
      ) {
        continue;
      }
      const group = makeChunkGroup(
        pending.descriptor,
        pending.revision,
        activeGeometry,
        activeElevation,
        activeFeatures,
        materialForCategory,
        materialForMappedRoad,
        landUseIndex,
        routeIndex,
        stylizedAssets,
      );
      removeChunk(pending.descriptor.key);
      scene.add(group);
      chunks.set(pending.descriptor.key, Object.freeze({ group, revision: pending.revision }));
      return;
    }
  };

  const draw = (): void => {
    animationFrame = null;
    if (!isActive || disposed) return;
    buildOnePendingChunk();
    windClock = advanceRideWindClock(windClock, performance.now() / 1000, playbackPaused);
    if (!playbackPaused) updateStylizedVegetationWind(scene, windClock.timeSeconds);
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(draw);
  };

  const start = (): void => {
    if (animationFrame === null && !disposed) {
      resize();
      animationFrame = window.requestAnimationFrame(draw);
    }
  };

  const setPose = (pose: RideCameraPose): void => {
    currentPose = pose;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    sky.position.copy(camera.position);
    const scale = activeGeometry?.projection.sceneUnitsPerMeter ?? 1;
    const horizon = 560 * scale;
    sky.scale.setScalar(Math.max(80 * scale, horizon * 1.4));
    camera.near = Math.max(0.00002, scale * 0.02);
    camera.far = Math.max(12, horizon * 2.2);
    camera.updateProjectionMatrix();
    sun.position.set(pose.position.x - 280 * scale, pose.position.y + 430 * scale, pose.position.z - 220 * scale);
    sun.target.position.set(pose.position.x, pose.position.y, pose.position.z);
    sun.shadow.camera.left = -180 * scale;
    sun.shadow.camera.right = 180 * scale;
    sun.shadow.camera.top = 180 * scale;
    sun.shadow.camera.bottom = -180 * scale;
    sun.shadow.camera.far = 920 * scale;
    sun.shadow.camera.updateProjectionMatrix();
    scene.fog = new THREE.FogExp2("#b9c8c7", 1.25 / Math.max(1, horizon));
    syncChunks();
  };

  const setRoute = (geometry: TrackMeshData): void => {
    if (routeGroup !== null) {
      scene.remove(routeGroup);
      routeGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      routeGroup = null;
    }
    chunks.forEach((_record, key) => removeChunk(key));
    pendingChunks = [];
    lastTerrainPlan = "";
    activeGeometry = geometry;
    routeIndex = createRouteConstraintIndex(geometry.routePoints);
    routeGroup = new THREE.Group();
    const road = new THREE.Mesh(createPartGeometry(geometry.topSurface, geometry.projection.sceneUnitsPerMeter), roadMaterial);
    road.castShadow = false;
    road.receiveShadow = true;
    routeGroup.add(road);
    const markings = createRideRoadMarkings(
      geometry.routePoints,
      geometry.roadHalfWidth,
      geometry.projection.sceneUnitsPerMeter,
    );
    const roadMarkingMesh = new THREE.Mesh(
      createPartGeometry(markings, geometry.projection.sceneUnitsPerMeter, true),
      markingMaterial,
    );
    roadMarkingMesh.receiveShadow = true;
    routeGroup.add(roadMarkingMesh);
    scene.add(routeGroup);
    if (currentPose !== null) setPose(currentPose);
  };

  return Object.freeze({
    setRoute,
    setEnvironment: (elevation: TerrainDemData | null, features: OpenStreetMapFeatures): void => {
      activeElevation = elevation;
      activeFeatures = features;
      landUseIndex = createLandUseSpatialIndex(features.areas);
      dataRevision += 1;
      lastTerrainPlan = "";
      syncChunks();
    },
    setCameraPose: setPose,
    setPlaybackPaused: (paused: boolean): void => {
      windClock = advanceRideWindClock(windClock, performance.now() / 1000, playbackPaused);
      playbackPaused = paused;
    },
    setActive: (active: boolean): void => {
      windClock = advanceRideWindClock(windClock, performance.now() / 1000, true);
      isActive = active;
      if (active) start();
      else if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    },
    dispose: (): void => {
      disposed = true;
      isActive = false;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      chunks.forEach((_record, key) => removeChunk(key));
      if (routeGroup !== null) {
        scene.remove(routeGroup);
        routeGroup.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
      }
      patternTextures.forEach((texture) => texture.dispose());
      groundMaterials.forEach((material) => material.dispose());
      mappedRoadMaterials.forEach((material) => material.dispose());
      stylizedAssets?.dispose();
      asphaltTextures.color.dispose();
      asphaltTextures.normal.dispose();
      roadMaterial.dispose();
      markingMaterial.dispose();
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      renderer.dispose();
    },
  });
};