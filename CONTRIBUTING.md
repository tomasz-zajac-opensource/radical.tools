# Contributing to radical.tools

Thank you for your interest in contributing! This document explains how to get involved.

## Ways to contribute

- **Report bugs** — open a [bug report](https://github.com/tomasz-zajac-opensource/radical.tools/issues/new?template=bug_report.md)
- **Request features** — open a [feature request](https://github.com/tomasz-zajac-opensource/radical.tools/issues/new?template=feature_request.md)
- **Submit code** — fork the repo and open a pull request
- **Improve documentation** — fix typos, clarify explanations, add examples
- **Share architecture patterns** — contribute to the [Architecture Hub](https://hub.radical.tools)

## Development setup

**Prerequisites:** Node.js ≥ 20, npm ≥ 9

```bash
git clone https://github.com/tomasz-zajac-opensource/radical.tools.git
cd radical.tools
npm install
npm run dev        # Electron app with hot-reload
npm test           # Run tests
npm run typecheck  # Type-check
```

## Project structure

```
src/
  main/       — Electron main process
  preload/    — Electron preload bridge
  renderer/
    src/
      ai/         — AI provider integrations and query language
      components/ — React UI components
      hooks/      — Custom React hooks
      store/      — Zustand state management
      types/      — Shared TypeScript types
tests/            — Vitest unit tests
```

## Pull request process

1. **Fork** the repository and create a branch from `main`.
2. **Write or update tests** for changed behaviour (run `npm test`).
3. **Type-check** — `npm run typecheck` must pass with no errors.
4. **Keep PRs focused** — one feature or fix per PR.
5. **Describe what and why** in the PR description.
6. A maintainer will review and merge or request changes.

## Coding conventions

- TypeScript strict mode; no `any` unless unavoidable
- React functional components with hooks
- State via Zustand + Immer slices in `src/renderer/src/store/`
- Tests live in `tests/` and use Vitest

## Commit style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add treemap export to PNG
fix: correct ELK layout for nested containers
docs: clarify metamodel editor usage
test: add sequence view collapse test
```

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
