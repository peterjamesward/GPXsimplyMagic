# GPX Simply Magic

A local-first TypeScript starter for opening and exploring cycling GPX tracks in a 3D viewer. Track parsing and route geometry are pure functions over readonly data; Babylon Lite handles WebGPU rendering and mouse navigation.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`). Do not open `index.html` through the IDE preview server (for example, `localhost:63342`): it serves `src/main.ts` as a static file instead of transforming it into a JavaScript module.

Use a WebGPU-enabled browser. Open a `.gpx` file with the button or drop one onto the viewer. Drag the track or background to pan the view while keeping the clicked location beneath the pointer, Control-drag to orbit around the road at the center of the image, right-drag to pan, and scroll to zoom toward the mouse pointer. Files are read in the browser and are not uploaded.

## Checks

```sh
npm test
npm run build
```