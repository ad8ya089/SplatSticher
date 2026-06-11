# Splat Stitcher

Standalone multi-room Gaussian splat world builder for real estate previews, horror rooms, escape games, and hide-and-seek style 3D walkthroughs.

## Live Development URL

Vite serves the app at:

```txt
http://127.0.0.1:5174/
```

If port `5174` changes, check `vite-dev.log`.

## What This Project Does

Splat Stitcher keeps each room as a separate splat scene instead of merging every room into one giant SPZ. The app analyzes SPZ/PLY splats, analyzes GLB colliders, places rooms on a floor-plan canvas, computes world transforms, loads the rooms into one Three.js viewer, and lets the player walk with collision.

`Build Tour` is the full-resolution proof mode: it aligns every current room through explicit named door anchors, loads each room's real SPZ splat, creates visible door handoff portals, and runs a sampled route check on each portal source and landing point. The browser exposes the latest result as `window.__splatStitcherReport` / `data-splat-stitcher-report`, the active loaded assets as `window.__splatStitcherActiveBuild` / `data-splat-stitcher-active-build`, and door handoff triggers as `window.__splatStitcherPortalTransitions` / `data-splat-stitcher-portal-transitions`.

The generated lite and portal-cut previews remain useful for quick diagnostics, but the main tour path now uses full SPZ room assets so the walkthrough matches `Full Room` visual quality instead of the old particle-preview look. Independent room captures do not need to share one physically continuous mesh; walking into a configured door lands the player just inside the matching door of the next room.

The current safe production workflow is:

1. Upload or select room splats and matching `_collider.glb` files.
2. Place each room box on the map.
3. Use `Build Tour` for a full-SPZ, door-stitched multi-room walkthrough.
4. Use `Full Room` to isolate and inspect a selected room's real SPZ at full quality.
5. For very large homes, keep an optimized/lazy mode available too. Six full rooms work in the demo, but full-SPZ tours are GPU and memory heavy.

## Luxury Penthouse Demo

Click `Penthouse` or the left `Estate` button to load a production-style real estate demo:

- Floor plan: `public/plans/luxury-penthouse-floorplan.png`
- Rooms: Living & Dining, Bedroom 4 Guest Suite, Bedroom 2, Master Bedroom Suite, Master Dressing, Spa Master Bathroom
- Source SPZ/GLB pairs: `public/environments`
- Generated preview assets: `lite_*.ply` and `portal_*.ply`

The map keeps the real floor-plan coordinate space, shows editable room boxes, and draws the green dashed tour route. `Build Tour` converts that route into a walkable six-room Gaussian splat tour with doorway cuts and connector floors.

## Buttons

- `Map`: shows the floor-plan canvas and draggable room boxes.
- `World`: shows the 3D rendered world.
- `Demo`: restores the default four attached demo rooms.
- `Estate`: loads the Luxury Penthouse floor-plan preset.
- `Plan`: uploads a floor-plan image behind the room boxes.
- `Room`: adds a new empty room card.
- `Spread`: spreads room boxes horizontally on the map.
- `Penthouse`: loads the Luxury Penthouse floor-plan preset from `public/environments`.
- `Build Tour`: includes all current rooms, aligns their named portal doors, loads the real full SPZ assets, and enables bidirectional door handoffs.
- `Full Room`: loads only the selected room using its real full SPZ file.
- `Generate`: loads the currently included rooms.
- `Reset`: resets the player camera in the world view.

## Room Panel Controls

- `SPZ/PLY/GLB`: upload the selected room visual file.
- `Collider`: upload the matching GLB collision mesh.
- `Include in world`: include or exclude the selected room from `Generate`.
- `Full SPZ asset`: switch a demo room between lightweight preview PLY and real SPZ.
- `Flip visual X`: manually flip the splat if an export appears upside-down.
- `Show colliders`: show or hide wireframe collider meshes.
- `Collision`: enable or disable physical walking collision.
- `Yaw deg`: rotate the selected room around Y.
- `Y offset`: manually adjust vertical placement.
- `Plan X` / `Plan Y`: precise floor-plan coordinates.

## Verification

Run:

```sh
npm run build
npm run validate:assets
npm run validate:property
npm run validate:portals
npm run validate:stitch
npm run generate:portal
npm run generate:property
```

Verified locally:

- Four-room joined preview reaches `World ready: 4 rooms; door path passable`.
- Luxury Penthouse tour reaches `World ready: 6 rooms; door portals ready (5 links)`.
- Luxury Penthouse validator checks 6 room SPZ/GLB pairs and confirms `0` portal-cut splat leaks.
- Luxury Penthouse portal validator checks 5 named bidirectional room links, 1.25m door spacing, source points, landing points, and destination yaw.
- Door stitch validation samples every 2-room, 3-room, and 4-room ordering of the four attached assets. `60 ordered combinations passed`.
- Portal preview validation confirms `0` splats remain inside the configured doorway cut boxes.
- Full Enchanted Castle SPZ reaches `World ready: 1 rooms`.
- Full 2M-point Hogwarts SPZ reaches `World ready: 1 rooms`, but takes roughly 90 seconds in the browser session.

## Future Property Pipeline

For a new listing:

1. Put the floor-plan image in `public/plans`.
2. Put each room `.spz` and matching `_collider.glb` in `public/environments`.
3. Add a preset in `src/core/propertyPresets.js` with room labels, plan box positions, SPZ/GLB URLs, footprints, named `portalDoors`, and `portalLinks`.
4. Run `npm run generate:property` to create lite and portal-cut previews.
5. Run `npm run validate:property`.
6. Open the app, load the preset, adjust boxes on the map, then click `Build Tour`.

The next deeper upgrade is automatic door discovery: render room views, segment `door` or `doorway`, lift the mask back to Gaussian indices, and write those exact indices into the portal cutter. The current version is deterministic and local: it uses configured doorway boxes, which is much more reliable for a working real estate pipeline today.

## Reference Repo Takeaways

The attached `segment-3gs` repo is useful for the next deeper version, especially:

- `splatIndex.ts`: build a spatial grid of Gaussian centers.
- `capture.ts`: freeze a camera pose and map 3D points into mask pixels.
- `lift.ts`: lift 2D masks back into 3D Gaussian indices.
- `registry.ts`: persist per-Gaussian selections with multi-view voting.

For this project, those ideas map to automatic door discovery: render room views, segment "door" or "doorway", lift masks to splat indices, and write those indices into the portal cutter instead of using only configured doorway boxes. The current build uses geometry-box cutting because it is deterministic, local, and does not require a GPU/SAM server.
