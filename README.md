# GPX Simply Magic

A local-first TypeScript app for opening and exploring cycling GPX tracks. Track parsing and route geometry are pure functions over readonly data; Three.js powers both the 3D route and first-person Ride views, and MapLibre provides the terrain map.

The **Ride** tab uses a dedicated WebGL scene with a first-person camera that follows the route at a selected cycling speed. Start or pause playback, scrub to a position, and follow the rider marker in the elevation profile. It streams nearby terrain in level-of-detail chunks, culls distant scenery, uses PBR road and land-cover materials, procedural sky and terrain shaders, soft sun shadows, fog, and antialiasing. Mapped OSM roads, buildings, water and land use are retained where available. Both 3D views use instanced, textured Pine, Oak and Aspen presets from the MIT-licensed EZ Tree package; the Ride view matches preset size to terrain chunk LOD, while the Route view uses the highest-detail presets. Tree placement remains illustrative rather than geographically exact. This visual prototype is not a complete photorealistic game environment; the shared tree-asset chunk is about 4.35 MB (3.07 MB gzip) and loads with the 3D Route renderer.

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