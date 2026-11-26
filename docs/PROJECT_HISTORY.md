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

The recorded test and build results for the changes above are in their corresponding conversation summaries; this history file itself is documentation and does not change application behavior.