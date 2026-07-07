# Changelog

All notable changes to the **Radical.Tools** VS Code extension are documented here.

## [0.2.0] — 2026-07-07

### Added
- Bundled diagram engine — no source checkout required after marketplace install
- Live VS Code theme sync — diagram UI automatically follows the editor's light / dark theme
- New `.radical` files are now initialised with the maximum built-in metamodel (C4 + DDD + Governance)

### Changed
- Display name updated to "Radical.Tools — C4 Architecture Diagrams"
- Extension icon and marketplace gallery banner added

## [0.1.0] — 2026-07-02

### Added
- Custom editor for `.radical` files (visual diagram canvas)
- JSON Schema validation and IntelliSense for `.c4.json` files
- Two-way file sync between the visual editor and the raw JSON
- Status bar button for `.c4.json` files
- Commands: Open current file, Open app, Stop, Show output log
- Build-on-demand prompt when the web renderer is not found
