# GPX Simply Magic

A local-first TypeScript starter for opening and exploring cycling GPX tracks in a 3D viewer. Track parsing and route geometry are pure functions over readonly data; Babylon Lite handles WebGPU rendering and mouse navigation.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`). Do not open `index.html` through the IDE preview server (for example, `localhost:63342`): it serves `src/main.ts` as a static file instead of transforming it into a JavaScript module.

Use a WebGPU-enabled browser. Open a `.gpx` file with the button or drop one onto the viewer; each loaded route is automatically centered and fitted to the view. The side-by-side Babylon 3D route and MapLibre terrain views synchronize their center, bearing, pitch, and approximate zoom, and can both control the camera. Double-click a track point in either view to center both views on it. Hover near the road to see the trackpoint number, distance from the start, gradient, and altitude. On the 3D route, drag to pan, Control-drag to orbit, and scroll to zoom toward the pointer.

The GPX file is parsed locally and is not uploaded. The terrain panel requires an internet connection: its detailed basemap uses OpenFreeMap's Liberty style and its global elevation data uses AWS Terrain Tiles (Mapzen; source data varies by region). Normal tile requests reveal the viewed geographic area to these services.

## Project history

See [the development narrative](docs/PROJECT_HISTORY.md) for the conversation-driven history of design decisions, fixes, and releases.

## Checks

```sh
npm test
npm run build
```