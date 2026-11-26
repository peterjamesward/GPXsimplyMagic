# GPX Simply Magic

A local-first TypeScript starter for opening and exploring cycling GPX tracks in a 3D viewer. Track parsing and route geometry are pure functions over readonly data; Babylon Lite handles WebGPU rendering and mouse navigation.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`). Do not open `index.html` through the IDE preview server (for example, `localhost:63342`): it serves `src/main.ts` as a static file instead of transforming it into a JavaScript module.

Use a WebGPU-enabled browser. Open a `.gpx` file with the button or drop one onto the viewer; each loaded route is automatically centered and fitted to the view. Switch between the Babylon 3D landscape and MapLibre terrain map using the tabs above the shared viewport; their center, bearing, pitch, and approximate zoom are synchronized. The Procedural terrain switch hides or shows the Babylon terrain and scenery without hiding the route; when terrain is hidden, a gradient-colored curtain beneath the route shows downhill sections in blue, level sections in green, and uphill sections in warm colors. The 3D landscape builds a local terrain mesh from elevation tiles, corrects the surface to the recorded GPX elevations along the route, and adds deterministic low-poly trees and houses. These trees and buildings are illustrative procedural scenery, not surveyed map features. Double-click a track point in either view to center both views on it. Hover near the road to see the trackpoint number, distance from the start, gradient, and altitude. On the 3D view, drag to pan, Control-drag to orbit, and scroll to zoom toward the pointer.

The GPX file is parsed locally and is not uploaded. Both 3D terrain and the MapLibre view require internet access for AWS Terrain Tiles (Mapzen; source data varies by region); the map's detailed basemap uses OpenFreeMap's Liberty style. Tile requests reveal the viewed geographic area to these services.

## Project history

See [the development narrative](docs/PROJECT_HISTORY.md) for the conversation-driven history of design decisions, fixes, and releases.

## Checks

```sh
npm test
npm run build
```