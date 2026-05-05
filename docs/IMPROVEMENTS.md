# radical.diagram — Improvement proposals

Two layers of suggestions: **functional** (what the user sees / can do) and **technical** (code quality / structure). Generated 2026-04-28.

---

## Part 1 — Functional improvements

### Modelling (Designer)

1. **Undo/redo** — must-have. Every move/delete is currently irreversible (milestones are too heavy for this).
2. **Multi-selection & group operations** — select N nodes → move together, delete together, "wrap into a new system/container".
3. **Quick search / jump (Cmd+P)** — find "Payment Service" in a model with dozens of nodes; pan camera to it.
4. **Duplicate node + subtree** — Cmd+D for whole subsystems ("clone microservice template").
5. **C4 model validation** — components without a container, cross-system relations without description, cycles. "Issues" panel with click-to-fix.
6. **Auto-save vs. dirty indicator** — Toolbar should show unsaved-changes state; warn on close.
7. **Export** — PNG / SVG / PDF of the whole diagram or current view.
8. **Import** — PlantUML / Structurizr DSL / Mermaid for onboarding.

### Views

9. **Auto-views per element** — "show everything related to this system" in one click (system + its containers + direct neighbours).
10. **View remembers layout too** — currently a view stores only `nodeIds`. Persist positions/zoom so each view ("Container View") has its own readable layout independent of "System Context".
11. **Auto-generated C4 view hierarchy** — System Context, Container, Component (per container) generated automatically rather than hand-built.
12. **Tag filtering** — add `tags?: string[]` to nodes (e.g. `legacy`, `external`, `pci-scope`); view = "everything tagged X".

### Relations

13. **Richer relation labels** — protocol (HTTPS/gRPC/Kafka), data direction, sync/async; today only `description`.
14. **Auto-routing around labels** — arrows sometimes cross neighbouring labels.
15. **Bundling parallel relations** — when A↔B has 3 relations, render them as a visual "bundle".

### Milestones (architecture over time)

16. **Side-by-side diff view** — what changed between v3 and v5: added/removed/changed nodes, highlighted on canvas.
17. **Auto-milestone** — every X edits or "milestone on save" so the user does not need to remember.
18. **Notes / changelog per milestone** — "what changed and why" field.
19. **Branching milestones** — experimental architecture variant as a "branch" off v3, with optional merge.

### Presenter / Viewer

20. **Presenter notes** — per slide, visible only to presenter.
21. **Smooth transitions** — pan/zoom interpolation between viewports instead of cuts.
22. **Spotlight per slide** — "highlight these 3 nodes on this slide", others dimmed.
23. **Slide annotations** — arrows, circles, text drawn on an overlay layer without changing the model.
24. **Export presentation** — PDF / PPTX (one slide per page).
25. **Publish / share link** — read-only viewer in a browser without Electron.
26. **Reorder slides** — drag-and-drop in the new bottom dock (verify if working).

### Layout

27. **Pin / lock node position** — "this node stays put, the rest can re-flow".
28. **Compact / spread toggle** — global "layout density" slider.
29. **Snap-to-grid + guides** — for manual dragging (already on the technical pending list).
30. **Layout per view** — different views, different algorithms / parameters.

### General UX

31. **Keyboard shortcuts + cheatsheet** — `?` shows the list. F5 alone is too little.
32. **Mini-map** (if not present) — large models require it.
33. **Zoom-to-fit, zoom-to-selection** — toolbar buttons.
34. **Dark mode** — often required for presentations.
35. **Templates / starter library** — "Microservices template", "3-tier web app" for quick start.
36. **Git-friendly model format** — deterministic JSON sort so model PRs are reviewable.
37. **Comments / discussions** — pinned to nodes/relations (Figma-style). Only meaningful if multi-user is planned.

### Top 5 by value/effort

1. **Undo/redo** (#1) — modelling stops being stressful.
2. **Export PNG/SVG** (#7) — first question every new user asks.
3. **Quick search Cmd+P** (#3) — instant boost past ~20 nodes.
4. **Presenter notes + spotlight** (#20, #22) — turns this into a real architecture-presentation tool.
5. **C4 model validation** (#5) — separates a "drawing tool" from a "design tool".

---

## Part 2 — Technical / code-quality improvements

### High impact

1. **Delete dead components** — verified unreferenced anywhere in source:
   - [src/renderer/src/components/Sidebar.tsx](src/renderer/src/components/Sidebar.tsx) (158 lines)
   - [src/renderer/src/components/ViewBar.tsx](src/renderer/src/components/ViewBar.tsx) (92 lines)
   - [src/renderer/src/components/PropertiesPanel.tsx](src/renderer/src/components/PropertiesPanel.tsx) (224 lines)
   - Plus orphaned CSS: [`.sidebar*` rules](src/renderer/src/index.css#L659-L710) and [`grid-area: viewbar`](src/renderer/src/index.css#L585). Keep `.sidebar-section` / `.sidebar-section-title` — still used by [RightPanel.tsx](src/renderer/src/components/RightPanel.tsx#L680-L681).
   - ≈ 470 LOC + ~60 CSS lines, zero behaviour change.

2. **Split `diagramStore.ts` (2474 lines)** into zustand slices in [src/renderer/src/store/](src/renderer/src/store):
   - `modelSlice.ts` — `c4Nodes`, `c4Relations`, CRUD, selection, `toggleCollapse`.
   - `viewSlice.ts` — `views`, `activeViewId`, `addNodeToView`.
   - `layoutSlice.ts` — `runRadicalLayout`, `runColaLayout`, `runElkLayout`, `runReferenceLayout`, live-cola wiring.
   - `snapshotSlice.ts` — milestones + diff/restore.
   - `presentationSlice.ts` — slides, presentations, HUD nav, viewport capture/restore.
   - `rfDerivationSlice.ts` — `rfNodes`/`rfEdges` build pipeline.
   - Compose via slice pattern; public API stays identical.

3. **Replace `(window as any).__rfGetViewport` etc.** with a typed canvas-API slice or React context exposing `useReactFlow()`. Removes most of the ~160 `any` casts and makes things testable.

4. **`TimeTravelBar` cleanup** — after the latest change [TimeTravelBar.tsx](src/renderer/src/components/TimeTravelBar.tsx) only renders for `viewer` mode. Either rename to `ViewerSlideStrip.tsx` or reuse the new `PresenterDock` in `readOnly` mode and delete `TimeTravelBar`.

### Medium impact

5. **Modularise `index.css` (2079 lines)** — split into `tokens.css`, `layout.css`, `panels.css`, `presentation.css`, `nodes.css`. Vite handles multi-import; reduces merge conflicts.

6. **Extract hooks from `Canvas.tsx` (627 lines)** — `useCanvasDnD`, `useViewportCapture`, `useCanvasKeyboard`.

7. **Side-effects out of actions** — `setActiveView` and `toggleCollapse` embed sibling-separation / parent-fitting math. Extract pure helpers (`fitParentToChildren`, `separateSiblings`) into `layout/`; easier to unit test and reuse.

8. **Persistence robustness** — schema-validate parsed JSON in `documentStore.ts`/persist layer; recover gracefully from corruption; wrap localStorage writes in try/catch (quota / private mode).

### Low impact / polish

9. **Stricter `tsconfig`** — enable `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Many `any` casts will surface as real refinements.

10. **Tests for store** — `presentationSlice.test.ts` (slide add/remove/reorder/link integrity), `snapshotSlice.test.ts` (milestone diff/restore round-trip).

11. **Memoisation in `RightPanel.tsx`** — `TreeNodeItem` runs several store selectors per node; large models re-render the whole tree. Build a children-by-parent map once per render.

12. **Consolidate icons** — [PresentationBar.tsx](src/renderer/src/components/PresentationBar.tsx#L7-L60), [Toolbar.tsx](src/renderer/src/components/Toolbar.tsx), [RightPanel.tsx](src/renderer/src/components/RightPanel.tsx#L131-L175), [TimeTravelBar.tsx](src/renderer/src/components/TimeTravelBar.tsx#L4-L14) each define their own SVG icon set. Move to `components/icons.tsx`.

13. **File-naming / split** —
    - [PresentationBar.tsx](src/renderer/src/components/PresentationBar.tsx) now exports `PresenterHUD`, `SlidesColumn`, `PresenterDock`, `PresentationBar`. Consider a `presentation/` folder, one component per file.
    - [RightPanel.tsx](src/renderer/src/components/RightPanel.tsx) (704 lines) actually exports both `LeftPanel` and `RightPanel`. Split.

### Suggested execution order

1. Delete dead components & CSS (5 min, zero risk).
2. Replace TimeTravelBar with read-only PresenterDock.
3. Split RightPanel.tsx + centralise icons.
4. Slice `diagramStore.ts` (biggest win, biggest care).
5. Replace `window.__rf*` with typed canvas-API slice.
6. Modularise CSS.
7. Strict TS + store tests.

---

## Appendix - Dynamic views (current usage)

Current status:

- The dynamic-view work is currently a domain/test foundation, not a finished editor feature.
- There is no dedicated UI, store CRUD, or renderer for sequence views yet.
- Today you use it by constructing `DiagramData` with `contexts` and `dynamicViews`, then calling the helper functions from [src/renderer/src/dynamicViews.ts](src/renderer/src/dynamicViews.ts).

Data model:

- Add business/journey/scenario definitions in `contexts`.
- Tag participating nodes and relations with `contextIds`.
- Define a `dynamicViews` entry with:
   - `contextId` - the business context anchoring the sequence
   - `viewId` - optional structural view scope
   - `lifelineOrder` - explicit participant order
   - `steps` - ordered interactions between existing nodes

Core types live in [src/renderer/src/types/c4.ts](src/renderer/src/types/c4.ts).

Minimal shape:

      {
         "contexts": [
            { "id": "checkout", "name": "Checkout Journey", "kind": "journey" }
         ],
         "nodes": [
            { "id": "user", "label": "User", "type": "person", "collapsed": false, "x": 0, "y": 0, "width": 100, "height": 100, "contextIds": ["checkout"] },
            { "id": "api", "label": "API", "type": "container", "collapsed": false, "x": 0, "y": 0, "width": 100, "height": 100, "contextIds": ["checkout"] }
         ],
         "relations": [
            { "id": "r1", "sourceId": "user", "targetId": "api", "label": "starts checkout", "contextIds": ["checkout"] }
         ],
         "dynamicViews": [
            {
               "id": "dv-checkout",
               "name": "Checkout Payment",
               "contextId": "checkout",
               "lifelineOrder": ["user", "api"],
               "steps": [
                  {
                     "id": "s1",
                     "seq": "1",
                     "fromId": "user",
                     "toId": "api",
                     "relationId": "r1",
                     "label": "Start checkout",
                     "kind": "sync"
                  }
               ]
            }
         ]
      }

Helper flow:

1. `normalizeDynamicViewCollections(data)`
    Use this first to normalize optional fields, remove duplicate tags/lifelines, and fill nullable values.
2. `getContextualElements({ nodes, relations }, contextId)`
    Use this to fetch only the model slice relevant to a given business context.
3. `validateDynamicView(view, { contexts, nodes, relations, views })`
    Use this to validate a sequence against the live structural model.

Validation rules currently check:

- the context exists
- the scoped structural view exists, when provided
- lifeline nodes exist and are unique
- every step source/target exists and is present in `lifelineOrder`
- optional `relationId` exists and matches the step endpoints
- warnings when lifelines or relations are outside the selected context
- warnings when lifelines are outside the scoped structural view

Best working example: [tests/dynamicViews.test.ts](tests/dynamicViews.test.ts).
