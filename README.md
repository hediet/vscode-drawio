# Draw.io VS Code Integration

[![](https://img.shields.io/twitter/follow/hediet_dev.svg?style=social)](https://twitter.com/intent/follow?screen_name=hediet_dev)

This extension integrates [Draw.io](https://app.diagrams.net/) into VS Code.

## Features

- Edit `.drawio` or `.dio` files in the Draw.io editor, as xml or both.
- Edit `.drawio.svg` files with embedded Draw.io diagrams (might be slow for diagrams with > 400 nodes).
- To create a new diagram, simply create an empty `*.drawio` or `*.drawio.svg` file and open it!
- `.drawio.svg` are valid `.svg` files.
- Uses an offline version of Draw.io by default.
- An online Draw.io url can be configured.
- A Draw.io theme can be selected.

## Demo

![](./docs/demo.gif)

## Editing .drawio.png Files (Not Released Yet)

_This feature is not released yet as it uses unstable VS Code APIs. This feature might be stable in the next release of VS Code ._

You can directly edit and save `.drawio.png` files.
These files are perfectly valid png-images that contain an embedded Draw.io diagram.
Whenever you edit such a file, the png part of that file is kept up to date.
This allows you to include Draw.io diagrams in readme files on github!

![](./docs/drawio-png.gif)

## Editing the Diagram and its XML Side by Side

You can open the same `*.drawio` file with the Draw.io editor and as xml file.
They are synchronized, so you can switch between them as you like it.
This is super pratical if you want to use find/replace to rename text or other features of VS Code to speed up your diagram creation/edit process.
Use the `File: Reopen With...` command to toggle between the text or the Draw.io editor. You can open multiple editors for the same file.

![](./docs/drawio-xml.gif)

## Change theme

For set light theme, add in your `settings.json` one of:

```jsonc
    "hediet.vscode-drawio.theme": "atlas" // Same as DrawIO
    "hediet.vscode-drawio.theme": "Kennedy" // Use if you'd like white menu on the top, not blue
    "hediet.vscode-drawio.theme": "min" // Use if you mostly view, not edit
```

Dark:

```json
    "hediet.vscode-drawio.theme": "dark"
```

<details>
 <summary><b>Screenshot Examples</b> (click to show)</summary>
  <!-- Please use HTML syntax here so that it works for Github and mkdocs -->
  <ul>
    <li> atlas: <br> <img src="docs/theme-atlas.png" alt="atlas" width="800"> </li>
    <li> Kennedy: <br> <img src="docs/theme-Kennedy.png" alt="Kennedy" width="800"> </li>
    <li> min: <br> <img src="docs/theme-min.png" alt="min" width="800"></li>
    <li> dark: <br> <img src="docs/theme-dark.png" alt="dark" width="800"> </li>
    </ul>
</details>
<br>

See all possible values (and settings) in [`package.json`](https://github.com/hediet/vscode-drawio/blob/master/package.json) file.

## See Also / Similar Extensions

- [Draw.io](https://app.diagrams.net/) - This extension relies on the giant work of Draw.io. Their embedding feature enables this extension! This extension bundles a recent version of Draw.io.
- [vscode-drawio](https://github.com/eightHundreds/vscode-drawio) by eightHundreds.

## Other Cool Extensions

If you like this extension, you might like [my other extensions](https://marketplace.visualstudio.com/search?term=henning%20dieterichs&target=VSCode) too:

- **[Debug Visualizer](https://marketplace.visualstudio.com/items?itemName=hediet.debug-visualizer)**: An extension for visualizing data structures while debugging.
- **[Tasks Statusbar](https://marketplace.visualstudio.com/items?itemName=hediet.tasks-statusbar)**: This extension adds buttons to the status bar to quickly start and kill tasks.
