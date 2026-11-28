# GPX Simply Magic

A local-first TypeScript app for opening and exploring cycling GPX tracks. Track parsing and route geometry are pure functions over readonly data; Three.js powers both the 3D route and first-person Ride views, and MapLibre provides the terrain map.

## Application architecture

The browser app follows The Elm Architecture: `src/app.ts` defines the immutable application model, messages, and pure `updateApp` transition; `src/appView.ts` derives the visible control state; and `src/main.ts` binds DOM events to messages and interprets effects such as GPX file reads, renderer updates, and terrain loading. The reducer and view projection are tested without starting WebGL or MapLibre, keeping interaction rules—including Ride pause/resume—independent of rendering.

The **Ride** tab uses a dedicated WebGL scene with a first-person camera that follows the route at a selected cycling speed. **Pause ride** holds the rider at the displayed position; **Resume ride** continues from there. Seeking with the slider pauses playback, and the button and position readout show the current playback state. Follow the rider marker in the elevation profile. The scene streams nearby terrain in level-of-detail chunks, culls distant scenery, and uses PBR road and land-cover materials, a sky-derived environment map, soft sun shadows, fog, and antialiasing. Mapped OSM roads, buildings, water and land use are retained where available; instanced trees and procedural texture detail make gaps look richer but are illustrative, not geographically exact. This remains a visual prototype rather than a complete photorealistic game environment.

Both 3D views use grass-blade and tree meshes adapted from [dedekpo/stylized-scene](https://github.com/dedekpo/stylized-scene), distributed under its MIT license in `public/stylized-scene/LICENSE`. The original scene's TSL/WebGPU shaders are not used; the app renders the meshes with WebGL-compatible Three.js materials and a lightweight wind vertex shader. Vegetation is deterministic, avoids mapped water, and keeps grass clear of the GPX road.

## Surface texture credits

The asphalt, leafy-grass, rock, and gravel photo-scanned surface maps in `public/surface-textures/` are adapted from the [Golden Hour Ride](https://github.com/jamiemarsland/golden-hour-ride) assets, which credit [Poly Haven](https://polyhaven.com) (CC0). Color maps are optimized local WebP files; the asphalt and grass normal maps use the source JPEGs to avoid further degrading their encoded vectors. No texture-service requests or weather presets are used.

## Elevation data sources

The terrain loader checks known elevation providers in order: the Environment Agency's WCS service where it covers England, regional LiDAR datasets indexed by [Flai's Open LiDAR Data catalog](https://github.com/flai-ai/open-lidar-data), and the [USGS 3DEP Elevation ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) for U.S. routes. The U.S. provider requests a bounded 2 km patch as a 256×256 GeoTIFF and decodes it locally; 3DEP is a bare-earth elevation service whose source resolution and acquisition data vary by location, and may combine LiDAR with other elevation sources. The [TechnicalGIS LiDAR Elevation Atlas](https://www.technicalgis.com/lidar-elevation-atlas/united-states/) informed source discovery but is not queried by the app. Vertical-datum transformations are not applied. Unavailable coverage or missing samples fall back to AWS Terrarium, and the in-view elevation badge names the source in use. Requests require an internet connection; dataset licensing and attribution vary by source and are linked from the viewer.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`). Do not open `index.html` through the IDE preview server (for example, `localhost:63342`): it serves `src/main.ts` as a static file instead of transforming it into a JavaScript module.

Use a WebGL-enabled browser. Load a `.gpx` file using the button or by dropping it onto the viewer; each route is centered and fitted automatically. Switch between the Three.js 3D route, MapLibre terrain, and first-person Ride tabs. The route and map cameras stay synchronized, and double-clicking a route point centers the views; hover over the route for point details. In the 3D view, drag to pan, Control-drag to orbit, and scroll to zoom toward the pointer. The terrain switch hides procedural terrain and scenery while showing the gradient curtain beneath the route.

The GPX file is parsed locally and is not uploaded. Terrain elevation uses the Environment Agency's LIDAR Composite DTM 2 m WCS where available; if that provider has no usable patch, the app checks [Flai's open-lidar-data catalog](https://github.com/flai-ai/open-lidar-data), intersects the dataset tile indexes with the visible terrain area, and reads only bounded COPC byte ranges for ground-classified points. Automatic catalog discovery is currently limited to listed European datasets and supported regional bounds; other regions (including the catalog's US topobathy data) use AWS Terrarium because coverage and product type vary. Open LiDAR sampling is bounded to three candidate datasets, six COPC files, 600,000 points, 24 MB of point payload, and a 129 × 129 raster per visible patch; the view badge identifies the selected dataset and whether Terrarium fills gaps. Dataset licences and attribution differ and are listed in the catalog; use the relevant source's licence for any derived data. Open LiDAR elevations are treated as metres without vertical-datum transformation, so absolute heights may differ from GPX or other elevation sources. The app also requests OpenFreeMap's Liberty basemap and land-use, road and building features from the NextGIS OpenStreetMap Overpass API. Route-area requests go to the Environment Agency, AWS terrain, OpenFreeMap, and NextGIS Overpass; Flai's S3 index and tile paths reveal the selected area, while GitHub's catalog is fetched without route coordinates and epsg.io receives only the dataset's coordinate reference code. The NextGIS personal endpoint identifier is visible to users inspecting browser requests. Overpass may be unavailable or rate-limited, in which case terrain and scenery fall back to procedural data. OpenStreetMap data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright); Environment Agency LiDAR is © Environment Agency copyright and/or database right 2022; AWS elevation tiles are sourced from AWS Terrain Tiles (Mapzen; data sources vary by region). Attribution links appear in the 3D view.

## Project history

See [the development narrative](docs/PROJECT_HISTORY.md) for the conversation-driven history of design decisions, fixes, and releases.

## Checks

```sh
npm test
npm run build
```