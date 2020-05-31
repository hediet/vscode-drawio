# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.6] - 2020-05-31

### Added

-   Read-only view when diffing diagrams.

### Changed

-   Better xml canonicalization. If only non-significant whitespace has been changed, the diagram should never reload.

### Fixed

-   Prevents Draw.io from marking the diagram as changed if it got reloaded from disk.

## [0.6.1]

-   Adds hediet.vscode-drawio.editor.customFonts to configure custom fonts.
-   Adds hediet.vscode-drawio.editor.customLibraries to configure custom fonts.
-   Encodes hediet.vscode-drawio.local-storage to make editing more difficult (other settings should be used for that).
-   Reloads diagram editor when the config changes.
-   Writes localStorage to the settings file it was read from.

## [0.6.0]

-   Implements a command that lets you export a diagram to svg, png or drawio.

## [0.5.2]

-   Implements a command that lets you convert a diagram to other editabled formats (e.g. drawio.svg).

## [0.5.1]

-   Fixes F1/Ctrl+Tab/Ctrl+Shift+P shortcuts.

## [0.5.0]

-   Reduces the size of the extension significantly.
-   Does not spawn an http server anymore to host Draw.io
-   Uses new Draw.io merge API for better Live-Share experience.

## [0.4.0]

-   Supports Draw.io features that required local storage:
    -   Scratchpad
    -   Languages
    -   Selected Libraries
    -   Layout Settings
-   Uses current VS Code locale settings for Draw.io.
-   Removes export options as they did not work.
-   Fixes bug when using VS Code remote development.
-   Fixes bug that caused empty drawio diagrams to be saved with xml compression.
-   Technical code improvements.

## [0.3.0]

-   Supports editing `*.drawio.svg` files.
-   Introduces `hediet.vscode-drawio.theme` to configure the theme used in the Draw.io editor.
-   Logs the drawio iframe/extension communication.
-   Fixes a memory leak.
-   Fixes a bug that resets the view/undo stack on save.

## [0.2.0]

-   Implements offline mode (enabled by default).
-   Implements config to disable offline mode.
-   Implements config to choose a custom drawio url.

## [0.1.3]

-   Treats `*.dio` files the same as `*.drawio` files.
-   Makes extension compatible with VS Code 1.44.

## [0.1.0]

-   Initial release
