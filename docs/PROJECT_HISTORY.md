# Project history

This document preserves the project's conversation-driven narrative: the requests, clarifications, and outcomes that shaped the GPX viewer. It is compiled from the issue descriptions and solution summaries available in the conversation history, so it is a narrative record rather than a verbatim export of every chat message.

## From starter to route viewer

1. **Build a local GPX editor/viewer starter.** The project began with a request for a pure functional, immutable TypeScript tool that could load a local GPX file and show its track in 3D, using Babylon Lite and possibly MapLibre. A local-first viewer was built with GPX parsing, route statistics, a 3D track, drag-and-drop loading, and mouse controls. MapLibre remained optional and was not added; Babylon Lite rendering requires WebGPU.
2. **Cover routes crossing the International Date Line.** An initial check found no tests for date-line-crossing routes; existing fixtures used nearby longitudes.
3. **Treat −179° to +179° as a 2° difference.** Longitude deltas were normalized for distance calculations, and sequential coordinates were unwrapped for geometry so the route follows the short arc across the date line. Regression tests were added.
4. **Resolve Safari's JavaScript MIME error.** The error came from opening TypeScript through the IDE's static server rather than Vite. The README was updated to direct users to the URL printed by `npm run dev`.

## Shaping the road

5. **Publish the project.** An initial local commit (`4a4be479a8e0d0a237a505550738da8c5ac4a5e7`) was made, but no remote was configured at that moment. The repository was subsequently confirmed public at `peterjamesward/GPXsimplyMagic`, with GitHub's remote `master` matching that commit.
6. **Make the route look like a road.** The rounded route tube was replaced with a closed slab: a four-metre-wide tarmac surface extending one metre below the route altitude.
7. **Correct twisted road sections.** The first slab geometry twisted at bends. Each point-to-point section was changed to a solid planar slab with horizontal cross-sections and elevation rising along the route, rather than across it.
8. **Color the road edges to check orientation.** The travel-left outer side became green and the travel-right outer side red; top, underside, and end caps remained asphalt.
9. **Put the tarmac on top and improve contrast.** The upper surface and exterior side faces were corrected, and the viewer background was lightened.
10. **Show faces from outside the slab.** Since surfaces still appeared invisible from some viewpoints, back-face culling was disabled for the road materials so faces render from either side.

## Navigation and framing

11. **Zoom toward the pointer and support Control-drag.** Wheel zoom was anchored to the cursor, and Control-primary dragging was initially introduced as a pan gesture.
12. **Make plain drag pan and Control-drag orbit.** The gesture mapping was clarified: plain primary drag pans, while Control-primary drag orbits around the route point beneath the viewport center. Changing the orbit pivot preserves the current view.
13. **Clarify what dragging means.** The request was explicitly not to edit or reshape the route. The intended feel is that the user drags the whole track, keeping the grabbed location beneath the pointer. Panning was adjusted to anchor the road point under the pointer, with a camera-plane fallback when no road point is picked; GPX data remains unchanged.
14. **Commit and push the navigation work.** Commit `874841926642a1e8af3b2d4c4b31ffb2cbcc1a0f` (`Improve route rendering and camera controls`) was pushed to `master`.
15. **Fit each newly loaded route.** Camera framing was updated to center and fit the complete rendered road slab, including its sides, with viewport-aware spacing.
16. **Correct east-west orientation.** Increasing longitude now maps east/right and increasing latitude north/up in the default view; regression coverage was added for coordinate and camera orientation.
17. **Commit and push route fitting and orientation.** Commit `f39905b` (`Fit loaded routes and correct map orientation`) was pushed to `master`.

## Route-point inspection

18. **Show route details on hover.** When a camera ray passes near the track, a Babylon overlay reports the trackpoint number, distance from the route start, gradient, and altitude, with a leader line to the point. Per-point route metadata, ray hit testing, tests, and usage guidance were added.
19. **Make the hover panel readable and usable.** Follow-up work addressed invisible text, zoom-dependent panel size, staying within the viewport, and weak picking at low zoom. The overlay was refined to use readable text, screen-space layout, a leader to the selected point, and camera-distance-aware hover tolerance.
20. **Show the gradient of the road ahead.** Each trackpoint now reports the gradient of the segment that follows it rather than the segment behind it; the final point has no following gradient. Regression coverage verifies the first, intermediate, and final points. The full test suite passed (36 tests), and the production build succeeded.

## Preserving the narrative

21. **Keep the project history with the repository.** This file records the sequence of requests and the resulting decisions so the development story can travel with the source, rather than remaining only in chat history.

## Map detail

22. **Load detailed map tiles as the view zooms in.** The MapLibre demo style only contained country-level vector tiles through zoom 6, so it could not show local roads when zoomed in. The basemap now uses OpenFreeMap's Liberty style, whose vector tiles include detailed road layers through zoom 14; the separate terrain elevation source and synchronized camera remain unchanged.

23. **Show elevation across the route area.** The MapLibre demo terrain source advertised global bounds but only served DEM tiles around one sample region, leaving other routes flat. The terrain source now uses AWS's public global Terrarium DEM tiles, with the matching 256-pixel tile size, encoding, and attribution.

24. **Center both views on a double-clicked track point.** Double-clicking a route point in the 3D view or terrain map centers the shared camera state on that point, preserving the current zoom and orientation; map clicks use a screen-space proximity check so double-clicking elsewhere retains normal map behavior.

25. **Render a terrain landscape around the known route.** The Babylon view now samples AWS Terrarium elevation tiles, smoothly constrains terrain heights to the GPX route profile, and adds deterministic low-poly foliage and buildings. The terrain and scenery are generated locally in the browser; procedural buildings and trees are illustrative rather than surveyed map data, and unavailable DEM tiles fall back to GPX-derived terrain.
26. **Anchor terrain correction at the road edges.** Terrain elevation correction now measures its influence from the outer edge of the road rather than the route centerline, so surrounding terrain transitions from the road boundary. Regression coverage verifies the edge-based anchor while retaining clearance beneath the road.
27. **Keep terrain clear of the complete road.** Clearance now accounts for every route segment, including sections between GPX points and nearby sections with different elevations, preventing the terrain mesh from cutting through the road. Regression coverage checks the full lower segment when another elevated route section passes nearby.
28. **Simplify the viewer controls.** The left information panels were removed, the loaded route title moved to the center of the top bar, and view selection became tabs attached to the shared viewport. A Babylon terrain switch hides procedural terrain and scenery while leaving the route visible.
29. **Show route gradient when terrain is hidden.** A gradient-colored curtain beneath the road distinguishes downhill sections in blue, level sections in green, and uphill sections in warm colors. Its extent is included when fitting the camera, and the terrain switch toggles it with the terrain.
30. **Revisit the road's box shape.** Added a TODO to replace the box-shaped road now that it no longer needs to be a box.
31. **Use mapped land cover and buildings in the 3D landscape.** Route-area features are requested from OpenStreetMap's Overpass API: mapped water, farmland, woodland, grassland, residential, and industrial polygons color the terrain, and building footprints are extruded using available height and colour tags. Procedural scenery remains as a fallback when data is missing or the service is unavailable; the 3D view links to OpenStreetMap attribution, and README documents the geographic-area requests.
32. **Add an interactive elevation profile.** The lower third of the shared graphics area now plots route altitude against cumulative distance with the same gradient colors as the 3D curtain. Profile hover reuses the trackpoint details card, double-click centers the synchronized 3D and map views, and wheel zoom and drag pan navigate the chart.
33. **Fit profile altitude to the visible route on zoom.** Scrolling now adjusts the altitude axis to the elevations within the newly visible distance range, including interpolated heights where the chart window cuts through a segment.
34. **Carry profile zoom into the route views.** Double-clicking the elevation profile now centers the route and tries to match the profile's horizontal meters-per-pixel scale in the synchronized 3D and map cameras, within MapLibre's supported zoom range.
35. **Synchronize double-click focus in both directions.** Double-clicking a route point in the 3D or map view now recenters and rescales the elevation profile to a comparable horizontal meters-per-pixel scale, while retaining the existing profile-to-route synchronization.
36. **Load Babylon terrain progressively with camera zoom.** The GPX-conformed terrain appears immediately, then elevation tiles load for the visible viewport at its current zoom. Zooming and panning request finer or newly visible coverage; existing elevations remain available as fallback while patches load and wherever finer tiles have gaps.

The recorded test and build results for the changes above are in their corresponding conversation summaries; this history file itself is documentation and does not change application behavior.

37. **Prototype a first-person Ride scene.** The first Ride tab used the existing Babylon scene for a route-distance camera with playback, selectable speeds, scrubbing, and an elevation-profile rider marker. It introduced the cockpit overlay, road markings, sunlight, and fog, but remained a fast prototype rather than the intended richer browser-rendered landscape.
38. **Build a dedicated game-style Ride renderer.** Ride now lazy-loads a separate Three.js WebGL scene with PBR asphalt and land-cover textures, custom sky/terrain shader detail, soft directional shadows, fog, and antialiasing. Terrain streams around the rider as visibility-culled chunks with near/mid/far mesh LOD; trees use instanced species meshes, while OSM road lines and individual building footprints, heights, and colours are placed into chunks. It reuses the GPX-conforming Terrarium terrain sampler; the available global DEM remains limited to zoom 15, with no LiDAR or aerial imagery source integrated yet.

39. **Consolidate the 3D route view on Three.js.** Replaced the Babylon Lite route renderer with a Three.js WebGL scene, porting route and terrain meshes, the gradient curtain, camera gestures, route picking, and the hover leader line while preserving the shared camera state used by MapLibre and the elevation profile. Removed the Babylon dependency and updated the browser requirement from WebGPU to WebGL.

40. **Prototype higher-detail Ride trees with EZ Tree.** Added the MIT-licensed EZ Tree package and replaced the Ride scene's procedural cones and canopy clusters with instanced textured Pine, Oak, and Aspen preset geometry. Preset size follows terrain chunk LOD and prototypes are cached per renderer; generation smoke checks completed for the presets. The production Ride chunk is now about 4 MB (3 MB gzip), so bundle weight remains a significant tradeoff; visual frame-rate and browser appearance checks remain outstanding.

41. **Use EZ Tree assets in both 3D views.** Replaced the Route view's generated low-poly tree meshes with the same instanced, textured Pine, Oak, and Aspen presets used in Ride. Terrain scenery now supplies deterministic placement metadata, while existing land-use placement rules, route clearance, terrain heights, and mapped buildings remain in effect.

42. **Return to procedural trees.** Removed the EZ Tree dependency and restored the procedural instanced Ride foliage and generated Route foliage from the pre-EZ implementation. This returns the application to the rendering state at `b04d6a4e` while retaining the experiment in this project history.

43. **Prototype stylized-scene grass and trees.** Added the MIT-licensed grass blade, trunk, foliage mesh, and alpha mask from [dedekpo/stylized-scene](https://github.com/dedekpo/stylized-scene) to both Three.js views. Deterministic instanced placements avoid the GPX road and mapped water, and terrain-chunk LOD reduces Ride grass density with distance. Since the source scene's TSL shaders require WebGPU, the prototype adapts its assets to WebGL-compatible materials and a small wind shader instead of importing the original renderer.

44. **Improve Ride materials using Golden Hour Ride techniques and assets.** Added optimized local WebP color maps and the source JPEG normal maps from [Golden Hour Ride](https://github.com/jamiemarsland/golden-hour-ride), whose README credits [Poly Haven](https://polyhaven.com) (CC0). Both route roads and the Ride road use the authored asphalt maps; Ride terrain chooses grass, gravel, or rock detail by mapped land use and blends toward rock on steep natural slopes while retaining the existing land-use colors and water styling. The Ride sky shader now also generates a PMREM environment map for image-based lighting and material reflections. Weather states were intentionally excluded.

45. **Use Environment Agency LiDAR where available.** The 3D route and Ride terrain now request bounded elevation patches from the Environment Agency's LIDAR Composite DTM 2 m WCS over its England coverage, prioritizing valid LiDAR samples and falling back to AWS Terrarium elsewhere or in data gaps. WCS requests use a capped raster size, and an in-view source badge reports LiDAR with Terrarium fallback or Terrarium alone; attribution is shown in the viewer and README.

46. **Use open-lidar-data where regional datasets are available.** When the Environment Agency WCS has no usable patch, the terrain loader checks Flai's public catalog, intersects dataset tile indexes with the viewport, and samples only bounded COPC byte ranges from ground-classified points. Requests are capped by candidate datasets, files, chunk size, and raster resolution; source labels identify the dataset, while Terrarium remains the gap and global fallback. Dataset-specific licences remain in the upstream catalog and are linked from the viewer and README.
47. **Search multiple LiDAR/elevation sources without making the UK the only provider.** Added a provider registry that tries the Environment Agency WCS, Flai's regional Open LiDAR Data catalog, and the USGS 3DEP Elevation ImageServer in sequence. USGS requests export a bounded EPSG:3857 GeoTIFF patch with wildcard CORS and decode it locally; 3DEP is a bare-earth DEM assembled from varying source resolutions and can include non-LiDAR elevation sources. Terrarium remains the coverage and sample-gap fallback. The [TechnicalGIS US LiDAR Atlas](https://www.technicalgis.com/lidar-elevation-atlas/united-states/) informed discovery; UI attribution links to the actual USGS service.