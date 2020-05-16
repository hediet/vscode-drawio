# Change Log

## 0.4.0

    - Supports Draw.io features that required local storage:
        - Scratchpad
        - Languages
        - Selected Libraries
        - Layout Settings
    - Uses current VS Code locale settings for Draw.io.
    - Removes export options as they did not work.
    - Fixes bug when using VS Code remote development.
    - Fixes bug that caused empty drawio diagrams to be saved with xml compression.
    - Technical code improvements.

## 0.3.0

    - Supports editing `*.drawio.svg` files.
    - Introduces `hediet.vscode-drawio.theme` to configure the theme used in the Draw.io editor.
    - Logs the drawio iframe/extension communication.
    - Fixes a memory leak.
    - Fixes a bug that resets the view/undo stack on save.

## 0.2.0

-   Implements offline mode (enabled by default).
-   Implements config to disable offline mode.
-   Implements config to choose a custom drawio url.

## 0.1.3

-   Treats `*.dio` files the same as `*.drawio` files.
-   Makes extension compatible with VS Code 1.44.

## 0.1.0

-   Initial release
