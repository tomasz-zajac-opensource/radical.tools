# radical.tools

C4 Architecture Diagram Tool — an Electron + React desktop application for creating, editing, and presenting software architecture diagrams using the [C4 model](https://c4model.com/).

## Features

- **C4 model support** — Person, Software System, Container, Component, Relation
- **Smart Layout** — SA-based auto-layout with crossing minimisation, edge-length optimisation, aspect-ratio penalty, and compound parent fitting
- **Multiple layout engines** — ELK (hierarchical/layered/force), webcola (live physics), and the custom Smart Layout pipeline
- **Time travel** — milestone-based undo/redo with named snapshots
- **Document manager** — multiple diagrams, local-storage + file-system backed
- **Presentation mode** — fullscreen view with navigation bar
- **Metamodel editor** — customise node types and relation types
- **Export** — save/load JSON diagrams; file-system import/export via Electron dialogs

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 29 |
| Bundler | electron-vite + Vite 5 |
| UI | React 18 + ReactFlow 11 |
| State | Zustand + Immer |
| Layout | ELK.js, webcola, custom SA pipeline |
| Language | TypeScript 5 |

## Getting started

**Prerequisites:** Node.js ≥ 18, npm ≥ 9

```bash
# Install dependencies
npm install

# Start in development mode (hot-reload)
npm run dev

# Type-check
npm run typecheck

# Production build (outputs to out/)
npm run build

# Run built app
npm start
```

## Project structure

```
src/
  main/         Electron main process (IPC handlers, file dialogs)
  preload/      contextBridge API surface exposed to renderer
  renderer/
    src/
      components/   React UI components (Canvas, Toolbar, Panels, …)
      layout/       Layout algorithms (smartLayout, elkLayout, liveColaLayout, …)
      store/        Zustand stores (diagramStore, documentStore)
      types/        C4 + metamodel TypeScript types
tests/
  visual/       Headless layout harness (SVG output for visual regression)
  *.test.ts     Unit / integration tests (run with tsx)
docs/
  IMPROVEMENTS.md  Architecture notes and improvement log
```

## Running tests

```bash
# Smart layout scoring regression
node --import tsx tests/smartLayoutScoring.test.mjs

# Visual layout harness (generates tests/visual/out-*.svg)
node --import tsx tests/visual/layoutHarness.mjs
# Convert SVG → PNG (requires librsvg: brew install librsvg)
for f in tests/visual/out-*.svg; do rsvg-convert -w 1400 "$f" -o "${f%.svg}.png"; done
```
