# GPX Simply Magic

A local-first TypeScript app for opening and exploring cycling GPX tracks. Track parsing and route geometry are pure functions over readonly data; Three.js powers both the 3D route and first-person Ride views, and MapLibre provides the terrain map.

The **Ride** tab uses a dedicated WebGL scene with a first-person camera that follows the route at a selected cycling speed. Start or pause playback, scrub to a position, and follow the rider marker in the elevation profile. It streams nearby terrain in level-of-detail chunks, culls distant scenery, and uses PBR road and land-cover materials, a sky-derived environment map, soft sun shadows, fog, and antialiasing. Mapped OSM roads, buildings, water and land use are retained where available; instanced trees and procedural texture detail make gaps look richer but are illustrative, not geographically exact. This remains a visual prototype rather than a complete photorealistic game environment.

Both 3D views use grass-blade and tree meshes adapted from [dedekpo/stylized-scene](https://github.com/dedekpo/stylized-scene), distributed under its MIT license in `public/stylized-scene/LICENSE`. The original scene's TSL/WebGPU shaders are not used; the app renders the meshes with WebGL-compatible Three.js materials and a lightweight wind vertex shader. Vegetation is deterministic, avoids mapped water, and keeps grass clear of the GPX road.

## Surface texture credits

The asphalt, leafy-grass, rock, and gravel photo-scanned surface maps in `public/surface-textures/` are adapted from the [Golden Hour Ride](https://github.com/jamiemarsland/golden-hour-ride) assets, which credit [Poly Haven](https://polyhaven.com) (CC0). Color maps are optimized local WebP files; the asphalt and grass normal maps use the source JPEGs to avoid further degrading their encoded vectors. No texture-service requests or weather presets are used.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`). Do not open `index.html` through the IDE preview server (for example, `localhost:63342`): it serves `src/main.ts` as a static file instead of transforming it into a JavaScript module.

Use a WebGL-enabled browser. Load a `.gpx` file using the button or by dropping it onto the viewer; each route is centered and fitted automatically. Switch between the Three.js 3D route, MapLibre terrain, and first-person Ride tabs. The route and map cameras stay synchronized, and double-clicking a route point centers the views; hover over the route for point details. In the 3D view, drag to pan, Control-drag to orbit, and scroll to zoom toward the pointer. The terrain switch hides procedural terrain and scenery while showing the gradient curtain beneath the route.

The GPX file is parsed locally and is not uploaded. The app requests AWS Terrarium elevation tiles, OpenFreeMap's Liberty basemap, and land-use, road and building features from the NextGIS OpenStreetMap Overpass API. The available Terrarium source is capped at zoom 15; no LiDAR or aerial imagery is currently integrated. These requests reveal the route's surrounding geographic area to those services; Overpass may be unavailable or rate-limited, in which case terrain and scenery fall back to procedural data. The NextGIS personal endpoint identifier is included in the browser app and is visible to users inspecting network requests. OpenStreetMap data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright); attribution is shown in the 3D view.

## Project history

See [the development narrative](docs/PROJECT_HISTORY.md) for the conversation-driven history of design decisions, fixes, and releases.

## Checks

```sh
npm test
npm run build
```