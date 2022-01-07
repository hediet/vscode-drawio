# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.4] - 2021-12-21

## Changed

-   Updates Draw.io to 16.0.0

## [1.6.3]

### Changed

-   Add support for settings:
    -   `style`
    -   `defaultVertexStyle`
    -   `defaultEdgeStyle`
    -   `colorNames`
-   `defaultColorSchemes` setting can now have a title attribute
-   Updates Draw.io to 14.9.9
-   Migrates to memento for draw.io local-storage

## [1.6.2]

### Fixed

-   Removes redundant web extension kind definition.

## [1.6.1]

### Fixed

-   Files can be linked again.

## [1.6.0] - 2021-07-11

### Changed

-   Updates Draw.io to 14.8.0
-   Code Link Match filter includes characters `<`, `>` and `,` to support generic class names (fixes [#240](https://github.com/hediet/vscode-drawio/issues/240)).

### Fixed

-   When Draw.io applies an external change to the document, it no longer emits another change (fixes [#215](https://github.com/hediet/vscode-drawio/issues/215)).
-   Emits proper line breaks instead of &#xa; (fixes [#209](https://github.com/hediet/vscode-drawio/issues/209)).
-   When execution of a command throws, a more detailed error message is shown (fixes [#239](https://github.com/hediet/vscode-drawio/issues/239)).

### Added

-   Uses full `zh-tw` language code (instead of just `zh`) if VS Code reports this language.
-   Makes the extension ui, workspace and web ready.

## [1.5.0] - 2021-05-29

### Changed

-   Updates Draw.io to 14.7.3.

### Added

-   Add support for untrusted workspaces.
-   Adds support for sketch theme.

## [1.4.0] - 2021-02-14

### Changed

-   Removes metadata from xml. This includes an etag, last modified date and other information.

### Added

-   SVG link targets are configurable now (see [#204](https://github.com/hediet/vscode-drawio/issues/204)).
-   Option to disable SVG 1.1 warning

### Fixed

-   When changing properties in the properties dialog and saving the diagram after applying the change, the diagram was saved as compressed xml (if it was opened as xml). With this fix it is always saved as uncompressed xml.

## [1.3.0] - 2021-01-17

### Changed

-   Updates drawio to 14.2.4.
-   Implements _Properties_ dialog to configure scale and border for SVG and PNG exports.

## [1.2.0] - 2020-11-19

### Changed

-   Updates drawio to 13.10.0.

## [1.1.0] - 2020-11-08

### Added

-   A context menu item has been added to the explorer view to link nodes to arbitrary files (see [#169](https://github.com/hediet/vscode-drawio/issues/169)).

### Fixed

-   `shift+f3` (find previous) is uncovered when the find-widget is visible (see [#174](https://github.com/hediet/vscode-drawio/pull/174), by [@fbehrens](https://github.com/fbehrens)).
-   Fixes that code link changes didn't trigger a document change.

## [1.0.3] - 2020-10-15

### Added

-   Add "Preset Colors" and "Custom Color Schemes" settings (see [#145](https://github.com/hediet/vscode-drawio/issues/145), by [@AvroraPolnareff](https://github.com/AvroraPolnareff)).
-   Add "New Draw.io Diagram" to the command palette (see [#145](https://github.com/hediet/vscode-drawio/issues/145)).

## [1.0.2] - 2020-10-12

### Fixed

-   Fix webview error when data directory is symlink (see [#152](https://github.com/hediet/vscode-drawio/pull/152), by [@jingyu9575](https://github.com/jingyu9575)).

## [1.0.1] - 2020-10-07

### Fixed

-   Fixes bug that leads to too many sponsorship dialogs.
-   Disables Alt+Shift+S and Ctrl+Shift+S, as everything save-related is handled by VS Code (see [#144](https://github.com/hediet/vscode-drawio/issues/144)).

## [1.0.0] - 2020-10-04

### Added

-   Enhanced Liveshare support: Cursors and selections of other participants are now shown.
-   Code Links can now refer to arbitrary code spans, not only to symbols.
-   Adds export/convert/save entries to the drawio menu.
-   Supports custom drawio plugins.
-   Other VS Code extensions can provide custom drawio plugins.
-   Adds a status bar item to quickly change the current drawio theme.
-   Adds drawio-language-mode (see [#130](https://github.com/hediet/vscode-drawio/issues/130)).
-   Users of the Insiders Build are asked for feedback after some activity time.
-   Users of the Stable Build are asked for sponsorship after some activity time.

### Changed

-   Updates drawio to 13.6.5.
-   Code Link looks for `#symbol` references in the entire label, not just in the beginning.
-   Hides the option to convert a drawio file format to itself.
-   Changes Category to "Visualization".

### Fixed

-   Fixes loss of data when changing theme in binary drawio editor with unsaved changes.
-   Fixes export/convert output to wrong directory when filepath contains '.' (see [#117](https://github.com/hediet/vscode-drawio/pull/117), by [@fatalc](https://github.com/fatalc)).
-   Fixes color problem when using light drawio theme in dark vscode theme (see [#129](https://github.com/hediet/vscode-drawio/issues/129)).

## [0.7.2] - 2020-06-28

### Added

-   Symbol Code Link Feature
-   "Draw.io: Change Theme" Command
-   Experimental Manual Code Link Feature (disabled by default)
-   Experimental Command "Edit Diagram as Text" (disabled by default)

### Changed

-   Uses `https://embed.diagrams.net/` as default URL when using the online mode.

## [0.7.1] - 2020-06-13

### Fixed

-   Fixes base URL. Resolves [#53](https://github.com/hediet/vscode-drawio/issues/53) and [#74](https://github.com/hediet/vscode-drawio/issues/74). (Implemented by [Speedy37](https://github.com/Speedy37))

## [0.7.0] - 2020-06-11

### Added

-   Support for creating and editing \*.drawio.png files!

### Changed

-   Ctrl-P is now forwarded to VS Code (see [#77](https://github.com/hediet/vscode-drawio/issues/77)).

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
