# Copilot Instructions for vscode-drawio

## Build & Development

```bash
yarn install               # Install dependencies (requires --frozen-lockfile in CI)
yarn build                 # Full build: extension + plugins + package VSIX
yarn build-extension       # Build extension only (webpack production)
yarn dev                   # Watch mode for extension development
yarn dev-drawio-plugins    # Watch mode for custom draw.io plugins
yarn lint                  # Currently a no-op; CI runs it anyway
```

The extension is packaged as a `.vsix` via `vsce package` (output: `dist/extension.vsix`). There is no test suite.

## Architecture

This is a **VS Code extension** that embeds [Draw.io](https://app.diagrams.net/) in a webview. The draw.io editor itself is included as a **git submodule** at `drawio/` (from `jgraph/drawio`).

### Entry point & bootstrapping

`src/index.ts` → `Extension.ts`. The Extension class wires together:
- **Config** — reactive settings (MobX observables over VS Code's settings API)
- **DrawioClientFactory** — builds webview HTML with the embedded draw.io app
- **DrawioEditorService** — manages open editors, commands, and status bar
- Two **CustomEditorProviders** registered for different file types
- Three **features**: CodeLink, EditDiagramAsText, LiveShare

### Two editor providers

| Provider | File types | Document model |
|---|---|---|
| `DrawioEditorProviderText` | `.drawio`, `.dio`, `.drawio.svg`, `.dio.svg` | VS Code `TextDocument` — two-way XML sync |
| `DrawioEditorProviderBinary` | `.drawio.png`, `.dio.png` | Custom `DrawioBinaryDocument` — in-memory XML, exports to binary on save |

### DrawioClient layer (`src/DrawioClient/`)

Communication with the draw.io iframe uses a JSON message protocol (`DrawioClient.ts`). `CustomizedDrawioClient` extends it with VS Code-specific actions (node selection, cursor tracking, custom vertices). `DrawioClientFactory` assembles the webview HTML, injects config, and uses **MobX autorun** to hot-reload when settings change.

### Features (`src/features/`)

- **CodeLinkFeature** — double-click a `#SymbolName` node to jump to code
- **EditDiagramAsTextFeature** — side-by-side XML editing
- **LiveshareFeature** — VS Live Share cursor/selection sync (subfolder with session model)

## Key Conventions

### MobX reactive state (v5)

The codebase uses **MobX 5** with legacy decorators (`experimentalDecorators: true`):
- `@observable` / `@observable.ref` for reactive properties
- `@computed` for derived state
- `autorun()` for side effects (e.g., regenerate webview HTML on config change)
- Import from `mobx` directly, not from wrapper libraries

### Disposable lifecycle pattern

All services, features, and editors extend or use `Disposable.fn()` from `@hediet/std/disposable`. Resources are registered with `this.track()` or `this._register()` for automatic cleanup. Always dispose subscriptions, autoruns, and event listeners this way.

### Event system

Custom events use `EventEmitter` from `@hediet/std/events`, exposed publicly via `.asEvent()`. This is used throughout for `onEditorOpened`, `onNodeSelected`, `onSave`, etc.

### Formatting

Prettier with **tabs**, trailing commas (`es5`), semicolons. See `.prettierrc.json`.

### Webpack bundling

Two separate webpack configs:
- Root `webpack.config.ts` — bundles the extension (`src/` → `dist/extension/`)
- `drawio-custom-plugins/webpack.config.ts` — bundles custom draw.io plugins (`dist/custom-drawio-plugins/`)

Both use `ts-loader`. The extension externalizes `vscode` and polyfills `path` with `path-browserify`.

### Plugin security

Draw.io plugins loaded from disk are SHA256-fingerprinted. Users must approve each plugin before it runs. See `DrawioClientFactory.ts`.
