# Draw.io VS Code Integration

[![](https://img.shields.io/twitter/follow/hediet_dev.svg?style=social)](https://twitter.com/intent/follow?screen_name=hediet_dev)

This extension integrates [Draw.io](https://app.diagrams.net/) into VS Code.

# Features

-   Edit `.drawio` or `.dio` files in the Draw.io editor, as xml or both.
-   To create a new diagram, simply create an empty `*.drawio` file and open it!
-   Uses an offline version of Draw.io by default.
-   An online Draw.io url can be configured.

# Demo

![](./docs/demo.gif)

# Editing .drawio.png Files (Not Released Yet)

_This feature is not released yet as it uses unstable VS Code APIs. This feature might be stable in the next release of VS Code ._

You can directly edit and save `.drawio.png` files.
These files are perfectly valid png-images that contain an embedded Draw.io diagram.
Whenever you edit such a file, the png part of that file is kept up to date.
This allows you to include Draw.io diagrams in readme files on github!

![](./docs/drawio-png.gif)

# Editing the Diagram and it's XML Side by Side

You can open the same `*.drawio` file with the Draw.io editor and as xml file.
They are synchronized, so you can switch between them as you like it.
This is super pratical if you want to use find/replace to rename text or other features of VS Code to speed up your diagram creation/edit process.
Use the `File: Reopen With...` command to toggle between the text or the Draw.io editor. You can open multiple editors for the same file.

![](./docs/drawio-xml.gif)

# See Also / Similar Extensions

-   [Draw.io](https://app.diagrams.net/) - This extension relies on the giant work of Draw.io. Their embedding feature enables this extension! This extension bundles a recent version of Draw.io.
-   [vscode-drawio](https://github.com/eightHundreds/vscode-drawio) by eightHundreds.

# Other Cool Extensions

If you like this extension, you might like [my other extensions](https://marketplace.visualstudio.com/search?term=henning%20dieterichs&target=VSCode) too:

-   **[Debug Visualizer](https://marketplace.visualstudio.com/items?itemName=hediet.debug-visualizer)**: An extension for visualizing data structures while debugging.
-   **[Tasks Statusbar](https://marketplace.visualstudio.com/items?itemName=hediet.tasks-statusbar)**: This extension adds buttons to the status bar to quickly start and kill tasks.
