# Radical.Tools — C4 Architecture Diagrams

**Visual C4 architecture diagram editor built directly into VS Code.**  
Model your software architecture with nodes, relations, and multiple synchronized views — no external tools required.

---

## Features

- **Visual drag-and-drop editor** for `.radical` files — opens automatically on double-click
- **Multiple metamodels** — start from C4, C4 + DDD Domains, or C4 + DDD + Governance (ADRs, Fitness Functions, Requirements)
- **Multiple views per model** — Canvas, Treemap, Matrix, Sequence, Table, Wiki — all driven from one source of truth
- **JSON Schema validation** — IntelliSense, autocomplete and error highlighting for `.c4.json` files
- **Live VS Code theme sync** — diagram UI automatically follows your editor's light / dark theme
- **Two-way file sync** — edit the raw JSON in any external editor; changes appear instantly in the diagram
- **AI assistant** — describe changes in plain language; the AI patches the model (requires API key)
- **Undo / redo**, snapshots, milestone tracking, presentations

---

## Getting Started

### New diagram

1. Create a file ending in `.radical` (e.g. `architecture.radical`)
2. VS Code opens it automatically in Radical.Tools
3. The editor initialises with the **C4 + DDD + Governance** metamodel — the fullest preset
4. Add nodes from the left-panel palette and connect them on the canvas

### Existing `.c4.json` file

Open the file in the text editor, then click the **⎈** button in the editor title bar to open the visual editor alongside it.

---

## Requirements

The diagram engine is **fully bundled** with the extension — no additional software or internet access is needed.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `radical.projectRoot` | (workspace root) | Override the project root used to locate a local source build. Leave empty for the bundled engine. |
| `radical.npmPath` | `npm` | Path to npm — only relevant when building the engine from source. |

---

## File Formats

| Extension | Behaviour |
|-----------|-----------|
| `.radical` | Opens directly in the Radical.Tools visual editor (custom editor, default priority) |
| `.c4.json` | Opens as JSON with schema validation; use the **⎈** toolbar button to open the visual editor |

---

## Commands

| Command | Description |
|---------|-------------|
| `Radical.Tools: Open current file` | Open the active `.c4.json` in the visual editor |
| `Radical.Tools: Open app` | Open the visual editor without a file |
| `Radical.Tools: Stop` | Close all Radical.Tools panels |
| `Radical.Tools: Show output log` | Show the extension output channel |

---

## Metamodels

Three built-in presets ship with the extension:

| Preset | Node types included |
|--------|---------------------|
| **C4** | Person, System, Container, Component, Database, Web App, Queue, Group |
| **C4 + DDD** | All C4 types + recursive **Domain** container |
| **C4 + DDD + Governance** | All above + **ADR**, **Fitness Function**, **Requirement**, **Blueprint** |

New files are initialised with the **C4 + DDD + Governance** preset.  
The metamodel can be customised per-document via the Radical menu → Schema → Metamodel editor.

---

## License

[MIT](https://github.com/tomasz-zajac-opensource/radical.tools/blob/main/LICENSE)
