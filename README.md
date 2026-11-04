# Draw.io Slides: a fork of the Draw.io VS Code Integration for decks of the draw.io presentation framework

This fork of [hediet/vscode-drawio](https://github.com/hediet/vscode-drawio), by Henning Dieterichs, is the editor of the decks of the draw.io presentation framework.
It installs beside the original, because every command, editor, setting and context key carries the prefix `drawioSlides.` and the extension is `yujunhuang.drawio-slides`.
The rest of this README is the README of the original, whose commands and settings read `drawioSlides.<name>` here in place of `hediet.vscode-drawio.<name>`.
The editor `hediet.vscode-drawio-text` of the original is `drawioSlides.textEditor` here, and the commands of the original show under the category `Draw.io Slides` in place of `Draw.io`.

## The fork loads the plugins of the framework without asking

The setting `drawioSlides.slides`, `false` by default and `true` in the `.vscode/settings.json` of a deck, loads the plugins in `drawio-custom-plugins/slides/` into the editor of every drawing it covers, without asking.
The plugins play the videos and show the pages of the cells, style the lists of the template and check the language with LanguageTool on this machine.
They also draw the pictures named relative to the deck, and keep the page view and the saved files as the build of the framework expects.
Their headers say what each one does.
The fork tells them the folder of the deck, the nearest folder above the drawing that holds a `package.json`.
The page of the editor gives the text of a label its font colour, where the original gives it the colour of the interface.
The editor also opens `*.drawio.xml`, the files of the decks.

Six settings of scope `resource` describe a deck, so that the `.vscode/settings.json` of each deck holds its own:

| setting | what it gives |
|---|---|
| `drawioSlides.colors` | the colours of the deck, each a name of letters and digits, such as `accent`, with a value `#RRGGBB`, which the formulas of every page may name, as in `\textcolor{accent}{x}`, and which the colour picker names and offers as presets |
| `drawioSlides.listStyles` | the indent, the marker and the colour and the size of the marker of each level of a bulleted and of a numbered list, and the gap between the items |
| `drawioSlides.listMarkers` | the markers of the menu List style |
| `drawioSlides.templates` | the multi-page template files of the deck, `${deckFolder}/templates/*.drawio.xml` by default, whose pages the submenu Insert slide of the menus Insert and Pages inserts |
| `drawioSlides.slideSize` | the size of a slide, 1920 by 1080 by default, which the page view keeps at one page |
| `drawioSlides.languageTool` | the address of the LanguageTool server that checks the label being edited, `http://localhost:8081` by default |

`${deckFolder}` in a path stands for the folder of the deck, and a relative path is read from that folder.
A colour of a level of `drawioSlides.listStyles` and a `fill`, `stroke`, `font` or `gradient` of `drawioSlides.customColorSchemes`, the swatches of the Style tab of the Format panel, may be the name of a colour of `drawioSlides.colors`.
The output channel Drawio Integration Log names each colour that the extension leaves out and each name of a colour that `drawioSlides.colors` does not define.
VS Code shows a swatch before each value of `drawioSlides.colors` in `settings.json`, and its colour picker edits the value.

The section Deck colours of the Format panel lists the colours of `drawioSlides.colors` in the editor of a drawing, each with its swatch and its name.
It sits in the Style tab, after the swatches and before Fill, in the Style tab of the diagram while nothing is selected, where it edits the list alone, and in the tab Text while a label is edited.
A click on a swatch gives each selected shape the colour by its kind: a text shape takes it as font colour, an edge and a shape whose fill draw.io does not draw as line colour, and any other shape as fill colour.
A selected group gives the colour to the shapes in it.
The buttons Fill, Line and Font of the row give the selected shapes the colour as fill, line or font colour alone.
A click on a swatch, on Fill, on Line or on Font sets the style keys of the colour options of draw.io, in one step of the undo history.
While a label of formatted text is edited, a click on a swatch or on Font gives the selected text the colour, as the option Font Color of draw.io does.
While a label of plain text is edited, the click gives the whole label the colour.
With an empty selection, a click on a swatch leaves the drawing as it is.
The tooltip of a swatch says what a click on it does for the selection at hand.
A shape takes the value `#RRGGBB` of the colour and keeps no link to its name.
The button ✎ opens the colour dialog of draw.io, which gives the colour a new value, and a new name in the text field renames the colour.
The button × removes a colour, and Add colour adds one, named `color1` or the next free number, with the value that the colour dialog gives.
The extension writes each change into `drawioSlides.colors` of the `.vscode/settings.json` of the workspace folder of the drawing, as an edit of that setting alone, so the comments of the file stay.
When the file is missing, or holds no `drawioSlides.colors` while another settings file defines it, VS Code writes the colours of the folder with the change into the `.vscode/settings.json` of the workspace folder.
A colour that the user settings or the file of a workspace of several folders define can be recoloured there, and the extension refuses to rename or remove it.
A rename also renames the colour where `drawioSlides.listStyles` and `drawioSlides.customColorSchemes` of the file name it, and leaves the formulas as they are, and a message says how many labels of the drawing name the old name in a formula.
The extension refuses a name that another colour has, a name of other characters than letters and digits starting with a letter, and a value other than `#RRGGBB`.
The extension also refuses a change while the settings file has unsaved changes.
A message in VS Code then gives the reason, and the section shows the colours as they were.

The editor follows a change of `drawioSlides.colors`, `drawioSlides.listStyles`, `drawioSlides.listMarkers`, `drawioSlides.customColorSchemes`, `drawioSlides.presetColors` and `drawioSlides.colorNames` without a reload, so the zoom and the undo history stay.
The formulas, the presets and the names of the colour picker, the swatches, the colours of the list markers and the menu List style take the new settings, and a list made after the change takes the new list style.
A colour taken out of `drawioSlides.colors` stays defined for the formulas until the editor reloads.
The editor also follows a save of a template file, whose pages the submenu Insert slide then offers.

The build of the framework reads the draw.io viewer, the plugins it shares with the editor and the defaults of these settings from the newest installed version of this extension, so that the slides it draws match the editor.
Its script `tools/draw-io/color-settings.py` writes the `\definecolor` lines of a TeX file into `drawioSlides.colors`, and the colours of the setting into a TeX file.

## The command Set Up a Presentation in This Folder starts a deck or sets up the editor for one

The command *Draw.io Slides: Set Up a Presentation in This Folder*, in the command palette and in the context menu of a folder in the Explorer, runs `tools/draw-io/build-slides.py` of the draw.io presentation framework on a folder.
The command sets up the folder clicked in the Explorer, or else the workspace folder, and asks which one when the workspace has several.
The setting `drawioSlides.frameworkFolder` names the folder of the framework.
When the setting names no folder that holds the script, the command opens a dialog to choose the folder, and the user settings keep the choice.
The setting has the scope `machine`, so the settings of a workspace cannot set it, because the command runs a script from that folder.
The command runs only in a trusted workspace, and needs `python3` on the path of VS Code, and `git` as well to start a presentation.

The command chooses what to run by what the folder holds:

| the folder holds | the command |
|---|---|
| no presentation and none of the files of a new one | asks for the title, the name of the folder by default, and runs `build-slides.py init`, which starts a presentation as a git repository of its own |
| a presentation, as its section files ending in `.drawio.xml` or its multi-page file, without `.vscode/settings.json` | runs `build-slides.py vscode`, which writes the settings and copies the template that the presentation lacks |
| a presentation with `.vscode/settings.json` | says that the folder is set up, and says how to load the plugins when the file does not set `drawioSlides.slides` to `true` |
| no presentation, and a `package.json`, a `.vscode/settings.json` or another file that `init` refuses to replace | names those files, suggests a new folder for the presentation, and runs nothing |
| the root of the framework itself | suggests a new folder for the presentation in it, and runs nothing |

Before the script runs, a dialog lists the files that it writes.
The output channel Drawio Integration Log shows the output of the script, and a message gives the reason when the script stops.
After `init`, a message says that `npm run build` in the folder builds the deck after `npm install` in `tools/` of the framework has run once.
VS Code reads the `.vscode/settings.json` of a workspace folder alone, so the editor opens the first section file only when the folder is a workspace folder, and the message otherwise offers to open the folder in a new window.

## Build the extension and install it

The build needs yarn 1 and the submodule `drawio`.
The continuous integration of the original builds with Node.js 22, and Node.js 23 needs `NODE_OPTIONS=--no-experimental-strip-types`, as the commands below set it:

```sh
git submodule update --init --depth 1 drawio
yarn install --frozen-lockfile
NODE_OPTIONS=--no-experimental-strip-types yarn build    # dist/extension.vsix
code --install-extension dist/extension.vsix --force
```

Reload the window of VS Code after an installation, with *Developer: Reload Window*.

## The README of the original

### Draw.io VS Code Integration

[![](https://img.shields.io/twitter/follow/hediet_dev.svg?style=social)](https://twitter.com/intent/follow?screen_name=hediet_dev)

This unofficial extension integrates [Draw.io](https://app.diagrams.net/) (also known as [diagrams.net](https://www.diagrams.net/)) into VS Code.  
Mentioned in the official diagrams.net [blog](https://www.diagrams.net/blog/embed-diagrams-vscode).

### Features

-   Edit `.drawio`, `.dio`, `.drawio.svg` or `.drawio.png` files in the Draw.io editor.
    -   To create a new diagram, simply create an empty `*.drawio`, `*.drawio.svg` or `*.drawio.png` file and open it.
    -   `.drawio.svg` are valid `.svg` files that can be embedded in Github readme files! No export needed.
    -   `.drawio.png` are valid `.png` files! No export needed. You should use `.svg` though whenever possible - they look much better!
    -   To convert between different formats, use the `Draw.io: Convert To...` command.
-   `.drawio` files are plain XML: they diff cleanly in git, and AI assistants can read, edit and review diagram changes like any other code.
-   Uses an offline version of Draw.io by default.
-   Multiple Draw.io themes are available.
-   Use Liveshare to collaboratively edit a diagram with others.
-   Nodes/edges can be linked with code spans.

### Demo

![](./docs/demo.gif)


### Editing .drawio.svg/.drawio.png Files

You can directly edit and save `.drawio.svg` and `.drawio.png` files.
These files are perfectly valid svg/png-images that contain an embedded Draw.io diagram.
Whenever you edit such a file, the svg/png part of that file is kept up to date.

The logo of this extension is such a `.drawio.png` file that has been created with the extension itself!

![](./docs/drawio-png.gif)

If you want readable diffs, for your reviewers and your AI tools alike, prefer `.drawio` over `.drawio.png` diagrams.

### Collaboratively Edit Or Present Diagrams

With version 1.0 of this extension, extensive support for [VS Code Liveshare](https://visualstudio.microsoft.com/de/services/live-share/) has been added. You can now edit or present your Draw.io diagrams remotely, while seeing each participant's cursor and selection! This can be used for discussing, reviewing or brainstorming diagrams.
With Draw.io's freehand drawing tool and integrated LaTeX support, this extension becomes an advanced whiteboard solution that can be used for remote code interviews!

![](./docs/liveshare-demo.gif)

_Internally, this extension synchronizes Draw.io diagrams with text documents.
These text documents are shared by Liveshare. As Liveshare has no understanding of the text, modification conflicts might occur on simultaneous modifications._

### Code Link Feature

In the status bar, you can enable or disable the code link feature.
If it is enabled and you double click on a node whose label starts with `#`,
you will perform a workspace search for a symbol matching the rest of the label.

If you have a node labeled `#MyClass` and a class of name `MyClass`, you will jump to its source if you double click the node!

**Please note that you have to open at least one file of the project that contains the symbol.**
Otherwise, VS Code will not consider this project when searching for symbols.
This file itself does not have to contain the symbol though.

Thanks to my latest github sponsors, this feature is open source and freely available now.

_TIP_: If you open the draw.io editor to the right side (i.e. the second editor column) and navigate to a symbol,
the diagram will stay visible.

![](./docs/demo-code-link.gif)

### Themes

<details>
    <summary><b>Available Draw.io Themes</b></summary>
    <!-- Please use HTML syntax here so that it works for Github and mkdocs -->
    <ul>
        <li><p>Theme "atlas"</p><img src="docs/theme-atlas.png" alt="atlas" width="800"></li>
        <li><p>Theme "Kennedy"</p><img src="docs/theme-Kennedy.png" alt="Kennedy" width="800"></li>
        <li><p>Theme "min"</p><img src="docs/theme-min.png" alt="min" width="800"</li>
        <li><p>Theme "dark"</p><img src="docs/theme-dark.png" alt="dark" width="800"></li>
    </ul>
</details>

### Associate `.svg` Files With The Draw.io Editor

By default, this extension only handles `*.drawio.svg` files.
Add this to your VS Code `settings.json` file if you want to associate it with `.svg` files:

```json
"workbench.editorAssociations": {
    "*.svg": "drawioSlides.textEditor",
}
```

You won't be able to edit arbitrary SVG files though - only those that have been created with Draw.io or this extension!

### Light and Dark `.drawio.svg` Files

By default, `.drawio.svg` files are saved with light colors, whatever theme the editor uses.
Set `hediet.vscode-drawio.svgAppearance` to `auto` to make them adapt to the color scheme of the page that shows them, for example a README on GitHub in dark mode, or to `dark` to always save them with dark colors.
The setting applies the next time a diagram is saved. Add it to the workspace settings so that everyone on a team saves the same file.

### Inline Diagrams in VS Code's Markdown Editor (Experimental, Insiders only)

VS Code Insiders ships an experimental WYSIWYG Markdown editor (`View: Reopen Editor With... > Markdown Editor`).
In that editor, every fenced code block tagged `drawio` is replaced by a live, resizable Draw.io editor:

````markdown
```drawio
<mxfile>...</mxfile>
```
````

Edits are written straight back into the fenced block, so the Markdown file stays the single source of truth and undo/redo, dirty state and hot exit keep working.
The block attributes of the inline editor are honored: `locked` makes a block read-only and `height=N` fixes its height, e.g. ```` ```drawio locked height=300 ````.
The Markdown editor's own lock toggle also puts the diagrams into read-only mode.

Notes:

-   VS Code's contribution point for this is experimental and only exists in Insiders builds; in stable VS Code (and in the regular Markdown preview) the fence is shown as text or rendered by the preview plugin as before.
-   Dynamic providers only run in trusted workspaces.
-   Settings that are baked into the editor (theme, appearance, custom libraries, fonts, ...) apply the next time the Markdown editor is opened.
-   Draw.io plugins are not loaded into the inline editors.

### Editing the Diagram and its XML Side by Side

You can open the same `*.drawio` file with the Draw.io editor and as xml file.
They are synchronized, so you can switch between them as you like it.
This is super practical if you want to use find/replace to rename text or other features of VS Code to speed up your diagram creation/edit process.
Use the `View: Reopen Editor With...` command to toggle between the text or the Draw.io editor. You can open multiple editors for the same file.
This does not make much sense for SVG files though, as the draw.io diagram is stored in its metadata.

The same goes for AI assistants: the file is a visual diagram for you and plain text for your agent.
When an agent edits the XML, the change shows up in the open diagram right away, and in a pull request it can read the diff of a diagram (an added node, a changed connection, a new label) and act on it just like it would on code.

![](./docs/drawio-xml.gif)

### Exporting Diagrams From Other Extensions

Other extensions, keybindings and automations can export a diagram file to SVG, PNG or `.drawio` without opening it and without prompts:

```ts
const uri = await vscode.commands.executeCommand("hediet.vscode-drawio.export", {
	source: "diagrams/architecture.drawio",
	destination: "public/diagrams/architecture.svg", // optional
	format: "svg", // optional: "svg", "png" or "drawio"
	overwrite: true, // optional, defaults to false
});
```

-   `source` and `destination` are a `Uri`, a URI string, an absolute path or a path relative to the first workspace folder. Missing folders are created.
-   Without `destination`, the export is written next to the source (`architecture.drawio` → `architecture.svg`). Without `format`, it is taken from the extension of `destination`, else SVG.
-   The saved file is exported, with the first page for multi-page diagrams. It is briefly rendered in a temporary editor tab that closes again.
-   The command resolves to the `Uri` of the written file and rejects with the reason if the export fails, e.g. because the destination exists and `overwrite` is not set.

Without arguments, the command is `Draw.io: Export To...`, which asks for the format and file of the diagram in the active editor.

### Contributors

-   Henning Dieterichs, [hediet](https://github.com/hediet) on Github (Main Contributor / Author)
-   Vincent Rouillé, [Speedy37](https://github.com/Speedy37) on Github

### See Also / Similar Extensions

-   [Draw.io](https://app.diagrams.net/) - This extension relies on the giant work of Draw.io. Their embedding feature enables this extension! This extension bundles a recent version of Draw.io.
-   [vscode-drawio](https://github.com/eightHundreds/vscode-drawio) by eightHundreds.
