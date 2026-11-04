# Presentations with Draw.io Slides: the slide template, the build and the editor set-up

A presentation, or deck, is a folder of draw.io files, one per section, that a person edits in the draw.io editor of this extension and an agent edits as XML text.
The build of the extension turns the folder into two things, both made of the same SVG of each page.
The first is one HTML file that presents the slides in a browser with their links, videos and interactive pages, and the second is a PDF.
The commands of the extension in VS Code and its command line `dist/cli.js` run the same build, so a person, an agent, a script and a CI job build a deck alike.
Paths in this guide that start at a folder of the extension, such as `deck-templates/`, are relative to the folder of the installed extension, or of a clone of this repository.

The folder `deck-templates/` holds what every presentation starts from:

| file | what it is |
|---|---|
| `slide-format.drawio.xml` | the template: six pages to copy slides from, three of which start a new presentation |
| `color-definitions.tex` | the starting palette, which the set-up writes into the setting `drawioSlides.colors` of a presentation, to change there: the `\definecolor` lines of the colors that the formulas of the co-design decks of the author name, whose header says where they come from |
| `named-colors.template.jsonc` | a color configuration of the editor to copy, with the names of the parts of draw.io that read its three settings |
| `named-colors-example.json` | an example color configuration of the editor, to replace with that of your own decks: the 26 colors of a deck of the author, with the names of their `\definecolor` for the colors of `color-definitions.tex` and of the codesign package, such as `green` and `cdF`, and names edited by hand for the others, so that no two names differ by a bracket or a shade word alone |
| `drawio-slides.cjs` | the launcher that the set-up copies into each presentation, which runs the command line of the newest installed version of the extension |
| `html-deck.html` | the page of the HTML file, whose placeholders the build fills in |

## The build needs the extension, git, Node.js and a Chromium

The build needs the following software:

- VS Code 1.90 or later with this extension, `yujunhuang.drawio-slides`, installed from its `.vsix` as the README of this repository says
- git, which makes each new presentation a repository of its own
- Node.js 20 or later with npm, for `npm run` and the command line
- a Chrome, an Edge or a Chromium for the export of the pages and for the PDF

The build draws each page with the diagrams.net viewer, the library of draw.io that draws a page in a web page, in a headless browser that it drives through `playwright-core`.
The browser is the first that starts of the Chromium that Playwright installs into its cache, Google Chrome and Microsoft Edge.
The command *Draw.io Slides: Install Chromium for the Build* installs that Chromium once for every presentation, and the build then needs no network.
The user setting `drawioSlides.browserPath`, or the option `--browser <path>` of the command line, names another browser by the path of its program.
The viewer is the copy that the extension bundles, so the build draws with the draw.io of the editor.
The build also reads the plugins that it shares with the editor, the template and the defaults of the settings of the slides from the folder of the extension.
The environment variable `DRAWIO_SLIDES_EXTENSION` names a clone of this repository in its place.
`DRAWIO_VIEWER` names another `viewer-static.min.js`, as a path, a `file:` address or an address on the web, such as `https://viewer.diagrams.net/js/viewer-static.min.js`.
A viewer on this machine finds MathJax, the stencils and the pictures in the folder `webapp` of draw.io around it, so it sits in `webapp/js/`.
The build stops on a local viewer outside `webapp/js/` of draw.io, and on a path that names no file.

## Start a presentation with the command Set Up a Presentation in This Folder

In VS Code, create a folder for the presentation, right-click it in the Explorer and run *Draw.io Slides: Set Up a Presentation in This Folder*.
The command asks for the title, lists the files that it writes, and writes them after the confirmation.
The command line does the same without VS Code, from the folder that holds the new one:

```sh
node <extension folder>/dist/cli.js init my-talk --title "My talk"
cd my-talk
npm run build
```

The extension folder of an installed version is `~/.vscode/extensions/yujunhuang.drawio-slides-<version>`, and a clone of this repository serves after its build.
`init` takes the folder relative to where it runs or as an absolute path, and creates the missing parent folders.
`init` refuses a folder that already holds a `package.json`, a `slides.drawio.xml`, a `sections/` that is not empty, a `.vscode/settings.json`, a `templates/slides.drawio.xml` or a `drawio-slides.cjs`, and a path below a file.
`init` also refuses to start when git is not installed.
`init` prints what it wrote:

```
sections/1-my-talk.drawio.xml written with the pages title-slide-1, section-divider-1, title-and-body-1
package.json, drawio-slides.cjs and .vscode/settings.json written, and .../my-talk is a git repository of its own
next, in .../my-talk: npm run build. Open the folder in VS Code to edit the slides.
```

A presentation is a git repository of its own, wherever it lies.
The user makes its first commit and adds its remote.

The new folder holds three slides, copied from the template: a title slide, a section divider and a slide of a title and a body.
Their text says what goes in each cell, in the style of real text, to overwrite in the `value` of each cell.
That text is the title, the date, the author and the affiliation of the title slide, and the title and the list of the body, whose formula and whose example of a word in italic show those constructs.

`init` writes the colors of `deck-templates/color-definitions.tex` into the setting `drawioSlides.colors` of `.vscode/settings.json` of the presentation, with the comment lines before each color and without the header of the file.
The formulas of the presentation then name those colors, as the section on colors below says.
`init` copies `deck-templates/slide-format.drawio.xml` to `templates/slides.drawio.xml`, the template of the presentation, from which the editor inserts a slide, as the section on VS Code below says.
`npm run build` prints what it did:

```
3 pages assembled from sections: 3 slides on 3 pages, and 0 backup slides on 0 pages
viewer: .../yujunhuang.drawio-slides-<version>/drawio/src/main/webapp/js/viewer-static.min.js
3 pages exported to .../my-talk/build/slides, 0 of them unchanged and copied from the cache
.../my-talk/build/my-talk.html written: 3 pages, 0 links, 0 videos, 0 embedded pages, 0 files beside the pages
3 pages printed to .../my-talk/build/my-talk.pdf
```

The command line prints each warning to its standard error, after `warning: `.
The commands of VS Code write the same lines and warnings into the output channel Drawio Integration Log.

The build exports several pages at once and copies a page that has not changed since the last build from `build/export-cache/`, so a build after an edit exports the edited pages alone.
`EXPORT_FRESH=1 npm run build` exports every page again.
A viewer on the web keeps the SVGs of the cache until `EXPORT_FRESH=1`, because the key of the cache holds the address alone of such a viewer.
`EXPORT_WORKERS` sets the number of pages exported at once, 4 by default, and `PAGE_WAIT` the most milliseconds that a page may take to draw, 15000 by default.
The pictures of the embedded pages wait `SNAPSHOT_LOAD_WAIT` milliseconds at most for the page to load, 30000 by default, and `SNAPSHOT_WAIT` milliseconds after the load, 500 by default.
The environment variables reach the command line and `npm run`, and the commands of VS Code take the defaults.

The pages count every step of a slide, so a slide in three steps is one slide on three pages.
`--outline` after `build`, `html`, `pdf` or `watch` in `package.json`, or `npm run outline` without a build, also prints the outline: each section file, and under it each slide with its number as the deck shows it and its pages.

## The scripts of package.json and the commands of VS Code build the presentation

Six scripts of `package.json` work on the presentation, and each has a command of the extension, in the command palette under the category Draw.io Slides:

| script | command of VS Code | what it does |
|---|---|---|
| `npm run build` | Build the Presentation | exports the slides, then writes the HTML file and the PDF |
| `npm run html` | Build the HTML File of the Presentation | exports the slides, then writes `build/<folder>.html`, which presents the deck in a browser with an outline, the links, the videos and the embedded pages, and copies the videos and the pages into `build/media/` |
| `npm run pdf` | Build the PDF of the Presentation | exports the slides, then prints them into `build/<folder>.pdf`, with bookmarks of the sections, of their slides and of the pages of a slide in steps |
| `npm run watch` | Watch the Presentation | writes the HTML file again whenever a section file is saved, renamed, added or deleted, a file under `assets/` changes, or `.vscode/settings.json`, which holds the colors, changes. `watch` reads the key `config` of `package.json` at its start, so a change of the key takes effect when `watch` starts again |
| `npm run outline` | Show the Outline of the Presentation | prints the sections, the slides and their pages, without building |
| `npm run check` | Check the Spelling and Grammar of the Presentation | checks the spelling and the grammar of every label with LanguageTool on this machine, and prints each issue with its slide, as the section on spelling below says. The script ends with exit status 1 when it finds an issue, and the command puts each issue into the Problems view |

A command of VS Code runs on the presentation of the folder clicked in the Explorer, or else of the file in the active tab, or else of the one workspace folder.
The commands that work on a presentation run only in a trusted workspace.
The build, the check and the installation of Chromium show their progress in a notification with the button Cancel, a watch shows an item in the status bar, and every command writes its lines and warnings into the output channel Drawio Integration Log.
*Stop Watching the Presentation*, or a click on the item of the watch in the status bar, stops a watch.

The `package.json` of a presentation holds these scripts and no dependencies.
Each script runs the launcher `drawio-slides.cjs` with its mode alone, such as `node drawio-slides.cjs build`.
The launcher runs `dist/cli.js` of the folder that `DRAWIO_SLIDES_EXTENSION` names, or else of the newest version of the extension that VS Code or VS Code Insiders has installed.
The scripts therefore work on every machine with the extension, and after each update of it.
`node drawio-slides.cjs --help` lists the modes and the options of the command line.
The facts of the presentation that the scripts share stand once, under the key `config`:

```json
"config": {
  "title": "My talk"
}
```

`init` writes `title`, and writes `slides-dir` and `deck` only for a slides folder other than `sections` or a file other than `slides.drawio.xml`, the values of `--slides-dir` and `--deck`.
An option given after the `--` of `npm run` takes the place of its key, so `npm run html -- --title "Another title"` gives the HTML file another title.
An unknown key of `config`, or a value of the wrong kind, such as a list in place of a title, stops each of the six scripts with a message that names the key.

### A presentation of the draw.io presentation framework moves to the launcher

A presentation that the Python build of the draw.io presentation framework started runs `build-slides.py` of the framework in its scripts, such as `python3 '../tools/draw-io/build-slides.py' build`.
The commands of VS Code build such a presentation as it is.
For `npm run` without Python, the mode `migrate` copies the launcher into the presentation and rewrites each such script to `node drawio-slides.cjs <mode>`, with the options and the environment variables that the script gave:

```sh
node <extension folder>/dist/cli.js migrate path/to/old-talk
```

`migrate` prints the changes and asks before it makes them, and `--yes` makes them without asking.
The key `config` and every other key of `package.json` stay as they were, and so does the layout of the file.
A script that names `build-slides.py` in another place, such as after `&&`, stays as it is, with a warning to rewrite it by hand.
The command Set Up a Presentation in This Folder offers the same move, in a dialog that lists the changes, on a presentation whose scripts run `build-slides.py`.

## A presentation folder holds its sections and what the build writes

```
my-talk/
├── .git/                             the repository of the presentation
├── .gitignore                        leaves out what the build, macOS and Claude Code write
├── .vscode/settings.json             the editor set-up and the colors of the presentation, written by the set-up
├── package.json                      the scripts, and the title under config
├── drawio-slides.cjs                 the launcher of the command line, which the scripts run
├── templates/slides.drawio.xml       the template of the slides, copied by the set-up
├── sections/
│   ├── 1-opening.drawio.xml          section 1, edited by hand
│   └── 2-results.drawio.xml          section 2, edited by hand
├── assets/                           pictures referenced as assets/<name>, and videos, when there are any
└── build/                            written by the build
    ├── <folder>.html, media/         the HTML file and the videos and pages it shows
    ├── <folder>.pdf                  the PDF
    ├── slides/slide-NN.svg           one SVG per page, which both are made of
    ├── assembled.drawio.xml          every page in one file
    ├── outline.json                  the bookmarks of the PDF
    ├── export-cache/                 the SVG of each page, kept for the next build
    └── page-snapshots/               a picture of each embedded page
```

Edit the section files, the pictures, the files of `templates/`, `.vscode/settings.json` and the key `config` of `package.json`.
The build writes `build/` again on every run.
A picture is a cell whose style holds `shape=image;image=assets/<name>`, and the build writes the picture into the page as data from its file, because the export reads no file beside the page.
The editor of VS Code shows such a picture from its file, through the plugin `deck-pictures.plugin.js` of the extension.
`node drawio-slides.cjs embed-pictures` writes each such picture into its cell as data, with its name kept in the style key `assetSource`, so that another draw.io editor shows it as well.
The build writes the picture of such a cell from its file again, so a changed picture shows in the next build.
A presentation of a single file `slides.drawio.xml` instead of `sections/` builds as well.

## The file names order the sections, and the page names give the slides

A section file is named `<number>-<name>.drawio.xml`, and the numbers order the sections.
Two files may not share a number, and the build stops with an error when they do.

A page is named `<name>-<step>`, such as `point-wise-probability-2`.
The pages present in the order of the files, and inside a file in the order of its page tabs in draw.io.
Pages that follow one another under one name are one slide shown in steps, which is how a slide makes something appear, so they share one slide number.

| page name | slide number shown |
|---|---|
| `title-slide-1` | 1/4 |
| `point-wise-probability-1` | 2/4 |
| `point-wise-probability-2` | 2/4 |
| `composition-1` | 3/4 |
| `summary-1` | 4/4 |

Nobody numbers a slide by hand.
Moving a page tab moves a slide, and renaming a file moves a section.
A name that ends in no `-<step>` is step 1.
Give two different slides two different names, or the build takes them for the steps of one slide.
A page whose name ends in `-hide`, such as `reset-metrics-example-1-hide`, stays in its file and out of the deck, and takes no slide number.

## The template defines the slide numbers, the formulas and the colors of a slide

The table points to the place of each part of a slide, and the sections below say more.

| what the slide shows | where it is defined |
|---|---|
| `45/61` at the bottom right of every slide that carries the number cell, which the title slide of the template does not | a cell holding `%slide%/%slides%`, which the build fills in |
| a formula inside a sentence | `\(...\)` in the label, typeset by MathJax in draw.io |
| a colored formula such as `\textcolor{green}{F}` | the setting `drawioSlides.colors` of `.vscode/settings.json` of the deck, whose colors the extension gives the editor and the build gives each page |
| the title, the body and the fonts | the pages of the template of the deck, `templates/slides.drawio.xml` by default, which the set-up copies from `deck-templates/slide-format.drawio.xml` |
| no slide at all for a page whose name ends in `-hide` | the build, which leaves the page out and gives it no number |

### The slide number reads current over total

A text cell whose value holds `%slide%` gets the number of the slide, and `%slides%` gets the number of slides.
The number cell of the template holds `%slide%/%slides%`, so the slide shows `45/61`.
The number of slides leaves out the slides of a section file whose name contains `backup-slides`, such as `7-backup-slides.drawio.xml`.
Those slides go on with the numbers past the total, and their `%slides%` adds the total with the backup slides, so after 40 slides and 14 backup slides the first backup slide shows `41/40-54`.
The editor shows the tokens themselves, because only the build fills them in.

The cell is right-aligned on one line, 200 px wide at x 1696 and y 1037, so the number ends at x 1896 and a longer number grows to the left and stays on the page.
Its style is `text;html=1;strokeColor=none;fillColor=none;align=right;verticalAlign=middle;whiteSpace=nowrap;overflow=visible;spacing=0;spacingTop=0;spacingBottom=0;spacingLeft=0;spacingRight=0;fontSize=22;fontFamily=Helvetica;fontColor=#000000;`.
A title slide carries no number cell, and still counts, so the three slides of a new presentation show nothing, `2/3` and `3/3`.

## A formula is written inside the sentence it belongs to

A formula goes between `\(` and `\)` inside the label of its sentence, so the sentence stays one cell:

```html
The cost \(\textcolor{red}{c}\) of a design is at most \(\textcolor{red}{r_1} + \textcolor{red}{r_2}\).
```

draw.io typesets a formula when the edit of the label ends, on a page whose mathematical typesetting is on.
A page made with the + tab of the editor starts with it off, unless the extension loads its plugin `math-definitions.plugin.js`, as the section on VS Code below says.
*Extras > Mathematical Typesetting* switches the typesetting on for the page on screen.
A duplicated page keeps the switch of the page it copies.

MathJax sets the formula in the font size of the words around it.
A `span` with a `font-size` and `font-family: Helvetica` sets it apart, `<span style="font-size: 40px; font-family: Helvetica">\(...\)</span>`, because MathJax scales a formula to the face around it.
A symbol set as text, such as e₁, is `<i>e</i><sub style="line-height: 0">1</sub>`, and the `line-height` keeps the line as tall as the others.
The page `text-with-mathematics-1` of the template shows each of these with its source beside it.

### The colors of a formula come from the setting `drawioSlides.colors` of the presentation

The MathJax of draw.io knows no color by a name of your own, such as `accent`, and draws it black, so a name needs a `\definecolor` before the formula is typeset.
The colors of a presentation are the setting `drawioSlides.colors` of its `.vscode/settings.json`, which maps each name to a value `#RRGGBB`, with a comment before a color where its use needs one:

```jsonc
"drawioSlides.colors": {
  // The color of the markers of the lists.
  "accent": "#004D80",
  "green": "#008000"
}
```

A name is letters and digits and starts with a letter, so that TeX reads it, and a value is `#` and six hexadecimal digits.
The extension and the build leave out an entry of another form, and the output channel Drawio Integration Log of the extension and a warning of the build name it.
The color picker offers the colors as presets after those of `drawioSlides.presetColors`, in the order of the names.
VS Code shows a swatch before each value in the settings file, and a click on the swatch opens its color picker, which writes the value back.
The section Deck colors of the Format panel of the editor lists the same colors, gives the selection a color of the list, and renames, recolors, adds and removes a color, as the README of this repository says.
Two places read the setting:

- In the editor, the extension defines every color on every page, so a new page needs no definitions of its own, and names the colors in the color picker and adds them to its presets.
  The editor follows a change of the setting without a reload, as the section on VS Code below says.
- In the build, every page gets a locked layer `Equation colors, added by the build` with the definitions its formulas use, before the export.
  The section files stay as they were saved.

The extension and the build give MathJax each color in the model `RGB`, such as `\definecolor{green}{RGB}{0,128,0}`, so the color picker, the formulas of the editor and the build take one value.
A page may still carry its own locked layer `Equation colors`, and the build then leaves the colors it defines to the page.
The commands that MathJax lacks are defined the same way, from `drawio-custom-plugins/slides/mathjax-commands.tex`, which lists them.

### The commands Import Colors from TeX and Export Colors to TeX convert the colors between the setting and a TeX file

A paper in LaTeX holds its colors as `\definecolor` lines of a TeX file.
The command *Draw.io Slides: Import Colors from TeX* asks for TeX files and writes their colors into `drawioSlides.colors` of the presentation, after a confirmation that names the number of colors.
The command *Draw.io Slides: Export Colors to TeX* writes the colors of the setting into a TeX file, `colors.tex` of the presentation by default.
The command line does the same, in the folder of the presentation:

```sh
node drawio-slides.cjs from-tex colors.tex
node drawio-slides.cjs to-tex colors.tex
```

The import writes the color of every `\definecolor` of the files into `drawioSlides.colors`, in the order of the files.
It reads the models `rgb`, `RGB`, `HTML`, `gray`, `Gray`, `cmy` and `cmyk`, and converts each color as the package xcolor converts it.
The comment lines before a definition become `//` lines before its color, so the comments of the TeX file stay with the colors.
The import replaces the value of `drawioSlides.colors` in the text of the settings file, or adds the key, and keeps every other key and comment of the file.
It stops before it writes on a definition that the setting cannot hold, such as a name with a hyphen.
The command refuses to import while the settings file has unsaved changes.

The export writes the colors of the setting as `\definecolor{<name>}{HTML}{<RRGGBB>}` lines, with the comments of the setting as `%` lines, for a paper to `\input`.
Its first line names the export and the settings file, and the import leaves that line out, so the two convert back and forth.

A presentation whose settings still hold `drawioSlides.colorDefinitions`, the list of the TeX files that held its colors before, stops the build with a message that names the files for the import.
Import the files, remove `drawioSlides.colorDefinitions`, and delete the TeX files that nothing else reads.
The extension reads no `drawioSlides.colorDefinitions`, and its output channel names the import while the settings hold it.

## A cell links to an address or to a slide, and a shape plays a video or shows an HTML page

Three properties of a cell reach the HTML file of `npm run html`: a link, a video and an HTML page.
The PDF shows the cell as it is drawn.

A link is set with *Edit Link*, Alt and Shift and L, on the cell.
The link is an address, such as `https://example.org`, which the HTML file opens in a new tab, or a page of the deck, chosen under *Page* in the same dialog, which the HTML file shows.
A link written inside the text of a label works as well.

A video is set on a shape, such as a rectangle, a rounded rectangle or an ellipse, with *Edit Data*, Cmd and M on a Mac and Ctrl and M elsewhere.
*Add Property* adds each property below to the cell.

| property | value | what it does |
|---|---|---|
| `video` | `assets/videos/demo.mp4` | the video, relative to the presentation folder, or an address that starts with `https://` |
| `fit` | `contain`, the default | the whole video, smaller than the shape where the two differ in proportion, with the fill of the shape around it |
| | `stretch` | the video rescaled to the shape, out of its proportion |
| | `crop` | the video filling the shape, with the parts outside the shape cut |
| `autoplay` | `1` | starts the video when its slide shows |
| `loop` | `1` | plays the video again from the start when it ends |
| `muted` | `1` | plays the video without sound |
| `barHideDelay` | `0`, the default | the seconds the bar of the HTML file stays after the pointer has left the video and the bar |
| `barFadeOut` | `0.25`, the default | the seconds the bar of the HTML file takes to fade out after that |

The video shows only inside the outline of its shape, so an ellipse shows an elliptic video.
The video lies where the shape lies among the cells: a cell later in the file covers it, as it covers the shape, and the video covers no cell in front of it.
A label of the cell itself shows above the video.
Fill the shape with a still of the video, so that the PDF and the editor without the plugin show the still.
A slide in steps whose pages keep the shape at the same place plays the video on from one step to the next.
On each step the video takes the `barHideDelay`, the `barFadeOut` and the `fit` of its cell there, and its loop and its sound stay as the bar left them.
Encode a video as MP4 with H.264, which every common browser plays, or as WebM with VP9.
The HTML file has been tried in Chromium alone, so try it in the browser of the talk before presenting.

The HTML file shows the same bar of controls as the editor, which the section on VS Code below describes, in place of the controls of the browser.
Every video has the bar, and the build reads no property `controls`, so a cell that still carries `controls="0"` shows the bar as well.
The menu of the right button of the browser stays on the video.
The bar shows right under the picture of a video while the pointer is over the shape of the video or over the bar, and while a field of the bar has the focus.
The bar touches the picture, so the pointer goes from the video to the bar without the bar going away.
When the pointer has left both, the bar waits `barHideDelay` and then fades out in `barFadeOut`, and it shows whole again when the pointer comes back meanwhile.
Set the two with *Edit > Edit Data* on the cell, such as `barHideDelay` to `1` for a bar that stays a second.
The editor shows its bar while the shape is selected, under the arrows of draw.io, and reads neither property.
An embedded page shows a bar of `Page ⟳ Reload` in the same way, right under its shape and with the same two properties, and its page takes the pointer without an Interact.
A browser seeks a video only when it can read any part of the file, which it can when the HTML file is opened as a file and when a server answers requests for ranges of a file, so a server that sends whole files makes the bar unable to jump.

An HTML page, such as an interactive three-dimensional plot, is set on a shape in the same way, with the property `html`:

| property | value | what it does |
|---|---|---|
| `html` | `assets/plots/surface.html` | the page, relative to the presentation folder, or an address that starts with `https://` |

The page shows inside the outline of its shape and in its place among the cells, as a video does, and a cell with both a video and a page shows the video.
In the HTML file the page takes the pointer at once, so a drag turns the plot and the wheel zooms it.
After a click in the page, the keys go to the page, and when the pointer leaves it they go back to the slide.
A slide in steps that keeps the shape at the same place keeps the page and its state, such as the angle of a plot, from one step to the next and back, in a browser with `Element.moveBefore`, such as Chrome or Edge from version 133.
Another browser loads the page again on each step.
Every build shows the page as it first draws.
The build loads the page in the headless browser at the size of its shape on the slide, takes a picture once it has drawn, and draws the shape as that picture in the PDF and in the exported SVGs.
The build keeps the pictures of its last run in `build/page-snapshots/`.
The build takes the picture of a local page again when the file of the page is newer than the picture, or a file that the page names in its `src` and `href` attributes is.
The build takes the picture of a page of another server on every build.
A page that gives no picture keeps the picture of an earlier build, with a warning, so a build offline still shows a page of another server.
The HTML file shows the picture under the page until the page has drawn, and the editor leaves the shape empty until then, so none of them shows a fill of your own.
Give the shape the shape image, because the build draws the picture as an image in its rectangle, and a picture as its fill shows only in the editor without the plugin.

The build copies the file of the page into `build/media/`, with the files that the page names beside it in its `src` and `href` attributes, with or without quotes, such as a script or a picture.
A video or a page outside the presentation folder goes to `build/media/outside/<hash>/`, and a page there takes along the files that it names in its own folder or below it.
A build removes from `build/media/` each file that the previous build of the same HTML file copied and the deck no longer uses, and names the files it removes.
The lists of the copied files are in `build/media/.deck-media.json`, and a file of your own in `build/media/` stays.
A file that a script of the page loads in another way, such as by `fetch`, is missing from the HTML file, although the editor finds it, so such a page keeps its data inside it.
A Plotly figure works in both places when it is written with its library inside, `fig.write_html("surface.html", include_plotlyjs=True)`, about 4 MB, or with its library beside it, `include_plotlyjs="directory"`.
A figure with its library from the web, `include_plotlyjs="cdn"`, works as well, and needs a network connection during the talk.
A page runs with the rights of the HTML file that shows it, and in the editor with the rights of the editor, where it could change the drawing, so embed only pages that you trust.

The page of the HTML file takes these keys:

| key | what it does |
|---|---|
| Right, Down, Page Down, Space | the next page |
| Left, Up, Page Up, Backspace | the page before |
| Home, End | the first and the last page |
| a slide number, then Enter | that slide |
| O | opens and closes the outline of sections, slides and steps |
| Escape | closes the outline |
| F | full screen |

The address of a page is its slide number, `#12`, and `#12.3` or `#12-3` is the third step of slide 12, so a link to the HTML file may open at a slide.
A move of the mouse shows a bar at the bottom left with the same commands, and the number of the page as the slides number theirs: `12-3/45` for the third step of slide 12, with the step only for a slide in steps, and `50/45-59` for a backup slide, after 45 slides and 14 backup slides.
The HTML file loads the font STIX Two Text from Google Fonts, so a computer offline shows the text in another serif face where the font is not installed.

The table of keys above is the one place that gives them, and `onKey` of `deck-templates/html-deck.html` handles them.

## Set up VS Code to edit the slides as drawings

The extension opens a `.drawio.xml` file as a drawing only when a setting associates the two, and it loads the plugins of the slides only when the setting `drawioSlides.slides` is `true`.
Open the folder of a presentation in VS Code, with *File > Open Folder…* or `code my-talk`, and its `.vscode/settings.json` holds both.
The set-up writes that file.
For a presentation that has none, the command Set Up a Presentation in This Folder writes it, and so does the mode `vscode` of the command line, which also takes the swatches of a color configuration:

```sh
# in the folder of the presentation
node <extension folder>/dist/cli.js vscode --colors <extension folder>/deck-templates/named-colors-example.json
```

The set-up refuses to replace a settings file that exists.
After it writes the file, the set-up copies the template into `templates/` when the presentation lacks it, because the settings name it.
The file it writes reads, without the swatches and with two of the colors of the starting palette:

```jsonc
{
  "workbench.editorAssociations": { "*.drawio.xml": "drawioSlides.textEditor" },
  "files.associations": { "*.drawio.xml": "drawio" },
  "drawioSlides.slides": true,
  "drawioSlides.templates": ["${deckFolder}/templates/*.drawio.xml"],
  "drawioSlides.colors": { "red": "#B20000", "green": "#008000" }
}
```

On a presentation with `.vscode/settings.json`, the command says that the folder is set up, and says how to load the plugins when the file does not set `drawioSlides.slides` to `true`.

With `drawioSlides.slides` on, the extension loads the plugins in its folder `drawio-custom-plugins/slides/` without asking:

- `math-definitions.plugin.js` defines the colors of `drawioSlides.colors` and the commands of `mathjax-commands.tex` on every page, as the section on colors above says, and starts every new page with mathematical typesetting on.
- `deck-colors.plugin.js` gives the color picker its presets and its names, and the Style tab of the Format panel its swatches, again after a change of the settings.
- `deck-colors-section.plugin.js` adds the section Deck colors to the Format panel, as the section on colors above says.
- `slide-settings.js` receives the settings that the extension sends after a change, and passes them to `math-definitions.plugin.js`, `deck-colors.plugin.js`, `deck-colors-section.plugin.js` and `list-styles.plugin.js`, as the paragraph after the templates says.
- `single-page.plugin.js` keeps a page of the size of the setting `drawioSlides.slideSize`, 1920 by 1080 by default, at one page in the page view, so content past the edge is cut as the build cuts it.
- `click-through.plugin.js` lets a click on the empty inside of a shape or a text box without fill select the shape behind it.
- `edit-at-click.plugin.js` keeps the view still when a double-click starts editing a label, and puts the caret at the character under the double-click.
  Without it, draw.io scrolls to show the whole source of the label, which is far longer than a formula drawn, and selects the whole label, so the next key would replace it.
  An edit started with F2, Enter or a typed letter keeps the behaviour of draw.io.
- `list-styles.plugin.js` gives a list the style of its level from the setting `drawioSlides.listStyles`, as the next paragraph says, with `list-marker-rules.js`, which writes the rules of the markers.
- `language-check.plugin.js` underlines the spelling and the grammar of the label being edited, as the section on spelling below says.
- `view-position.plugin.js` leaves the position of the view, the attributes `dx` and `dy` of `<mxGraphModel>`, out of every page that the editor saves, so a scroll alone changes no section file.
  A file then opens at the default view of the editor.
- `deck-pictures.plugin.js` draws a picture whose style names a file of the presentation, such as `image=assets/plot.png`, from that file.
- `insert-slide.plugin.js` adds *Insert slide* to the menus *Insert* and *Pages*, with one entry per page of each template, as the paragraph after the list styles says.
- `deck-files.js` gives the plugins that read a file of the presentation, such as a video or a picture, the address of the file in the editor.
- `media-bar.js` holds the bars of controls of a video and of a page, which `media.plugin.js` uses and the HTML file shares.
- `media.plugin.js` plays the video of a shape with the property `video` and shows the page of a shape with the property `html`, inside the shape, as the HTML file shows them.

The extension tells the plugins the folder of the presentation, the nearest folder above the drawing that holds a `package.json`.
Its page gives the words, the bullets and the formulas of a label the font color of the label, as the build does.

`list-styles.plugin.js` acts when the buttons Bulleted List, Numbered List, Increase Indent and Decrease Indent of *Format panel › Text*, or Tab in a list, make or move a list.
The setting `drawioSlides.listStyles` gives each level of a bulleted and of a numbered list its indent, its marker and the color and the size of the marker, and `itemGap`, the gap above every item but the first of a first level.
Its default, in `contributes.configuration` of the `package.json` of the extension, is the style of the template, which this paragraph restates.
The first level takes the marker `disclosure-closed` and an indent of 26.07 px, the second the marker `'-  '` and an indent of 43.93 px, and a deeper level a dot.
Every item but the first of a first level sits 8.44 px below the one before.
A numbered list takes 1., a. and i. by level.
The same plugin adds the menu *List style* under those buttons, which shows while a label is edited and names the marker of the list at the caret, from the markers of the setting `drawioSlides.listMarkers`.
Choosing a marker sets it on that list alone, and *Template* gives the list the style of its level in the template again.
Both write the style into the HTML of the label, so the HTML file and the PDF show the same marker.
A choice in the menu stays out of the history of the browser, so Undo inside the label takes back the change before the choice instead.
The Undo of the drawing after the edit takes back the whole edit, the choice included.
The default draws the triangle and the dash in the color and the size of the points of the Keynote deck of the template, as the header of the plugin says.
The color of a level may be the name of a color of `drawioSlides.colors`, such as `accent`, which the editor and the build replace by its value.
A name that `drawioSlides.colors` does not define stays as written, with a line in the output channel of the extension and a warning of the build.
The build reads the same setting from `.vscode/settings.json` of the presentation, or its default, and copies the rules of the markers into the SVG of each slide with a list.
A slide setting in the user settings of VS Code is out of the sight of the build, so a presentation keeps its slide settings in its own folder.

The setting `drawioSlides.templates` lists the templates of the presentation, multi-page draw.io files whose pages are the layouts of the slides, each named by its layout.
The set-up writes `["${deckFolder}/templates/*.drawio.xml"]`, the default of the extension, so `templates/slides.drawio.xml` is the template of a new presentation, and a presentation changes its copy or adds another file there.
`${deckFolder}` stands for the folder of the presentation, and a relative path of the setting is read from that folder, in the editor and in the build alike.
Each presentation holds its templates and its colors in its own repository, so a change of the template or of the starting palette of the extension reaches a presentation only when the presentation copies it again.
*Insert slide* inserts a copy of a layout after the current page, named after the layout with `new` and a number, such as `title-and-body-new-1`, so that the build counts it as a slide of its own until it is renamed.
The menu shows a template as it was last saved, without a reload of the window.

As the README of this repository says, the editor of a presentation follows a change of `drawioSlides.colors`, `drawioSlides.listStyles`, `drawioSlides.listMarkers`, `drawioSlides.customColorSchemes`, `drawioSlides.presetColors` and `drawioSlides.colorNames` without a reload, so the zoom and the undo history stay.
Reload the window after a change of another setting or a new version of the extension, with *Developer: Reload Window* in the command palette.
The `.drawio.xml` name keeps the editor from compressing the XML on save, so the file stays readable as text.

In the editor the video plays muted and in a loop, and a click goes through it to the shape, so the shape is selected, moved and resized as before.
When the shape of a video is the one selected cell, a bar under the shape controls the video.
The bar sits below the arrows that draw.io shows around a selected shape, or above the shape when the view has no room below:

| control | what it does |
|---|---|
| ⏮ | back to the start |
| «5, 5» | back or forward 5 seconds |
| ▶, ❚❚ | play or pause |
| the slider | the position. A drag holds the video while it moves and plays it again on release. While the slider has the focus, the arrows move it by 0.1 s, or by 1 s with Shift |
| `0:01.250 / 0:05.000` | the time and the length, always to the millisecond. A time typed into the field, such as `1:02.5`, `62.5` or `5`, and Enter go there. A value that does not parse changes nothing, a value outside the video goes to its nearer end, and Escape leaves the field |
| `1×` | the speed, from 0.25× to 2× |
| ↻ | the loop, on when bright |
| 🔇, 🔊 | the sound, off at the start |

A click or a drag on the bar selects and moves no cell.
After a click on a control of the bar, a drag of the slider or a choice in the list of speeds, the control keeps the focus.
The bar then takes the keys, so the arrows, Delete and the shortcuts of draw.io change no cell.
The arrows move the video while the slider has the focus, Space and Enter press a button, and Tab and Shift and Tab go round the controls of the bar.
Enter or Escape in the field of the time leaves the focus on the bar, and the field shows the time of the video again.
A press of the pointer outside the shape and its bar gives the keys back to the drawing, and a press on the shape or a drag of it keeps them in the bar.
A double-click that edits the label of the cell gives the keys to the label.
A paste, a cut or a copy while a control of the bar has the focus stays in the bar, so it never adds a cell to the drawing or takes one out.
In the HTML file the focus goes back to the slide after a click on a button, a drag of the slider and a choice of a speed with the pointer.
The arrows of the HTML file move the video while the slider has the focus, after Tab has given it the focus through the buttons of the bar.
A video keeps its time, its pause, its speed and its sound through zooms, edits, redraws of the page, and the undo of a move, a resize or a change of style.
When the drawing shows another of its pages, a cell there with the id and the file of a cell of the page before takes the video over as it was, wherever the cell sits.
Every other video starts again from the beginning, muted, as after the undo of the deletion of its cell.
A bar that reads `not playable` belongs to a video that did not load, and the console of the webview names the cause.
The bar does not show in the PDF or in a drawing exported from the editor, and the HTML file shows it while the pointer is over the shape, as the section on the HTML file says.

The editor shows an HTML page of the property `html` in its shape as well, and the page takes no pointer, so the shape is selected, moved and resized as before.
When the shape of a page is the one selected cell, a bar under it reads `Page ☐ Interact ⟳ Reload`.
*Interact* lets the pointer act on the page, such as a drag that turns a plot, until it is clicked again or the shape is deselected.
A double-click on the shape selects it and switches Interact on, and F2 or Enter edits its label instead.
*Reload* loads the page again, after its file has changed, and keeps the page shown until the new one has drawn, in the editor and in the HTML file.
The bar reads `loading` until the page has loaded, and the shape stays empty meanwhile, because the image of the shape of a page is left out.
The page lays out at the size of its shape on the slide and is scaled to the zoom, as in the HTML file, so its text keeps its size against the slide at every zoom.
Interact changes only where the pointer goes, so the page looks the same with it on and off, until the pointer acts on the page.
A page keeps its state through zooms, moves, redraws, and the undo of a move, a resize or a change of style, and passes to a cell of another page of the drawing as a video does.
Every other page loads again when its page of the drawing is shown again, and after the undo of the deletion of its cell.
The bar of a page keeps the focus after a click as the bar of a video does.
After a click in the page with Interact on, the keys go to the page, also after the pointer has left it, until a press of the pointer outside the shape and its bar.
A key that the page leaves unused, such as an arrow in a page without a scroll bar, may still scroll the view of the drawing.
`click-through.plugin.js` passes a click on the empty inside of the shape of a page to the shape behind it, so the click counts as a press outside.
The build of a deck gives the shape of each page its picture as an image, so a click inside the shape of a built deck keeps the keys in the page.
The editor reads a page of the deck and hands its text to the frame, with the folder of its file as the base of its links, because VS Code serves the files of the open folder only to the page of the editor itself, so the page finds every file beside it.
A page of another server loads from its address.
The bar says `not loaded` when that address cannot be reached, and the frame shows the page of the browser when the server answers with an error or refuses to be shown in a frame.

VS Code plays an MP4 file from its address.
Its media library opens no WebM file, so the plugin reads a WebM file whole and plays it through the Media Source Extensions of the page, which read WebM on their own.
A WebM file therefore waits until it is read whole.
The page holds about 150 MB of one video this way, so a larger WebM file plays its first part and loops there, and the console of the webview says how many seconds play.
A WebM file from another server plays only when that server allows the page to read it, which few servers do.
Give a long video, or one from another server, as MP4 with H.264.
VS Code serves the files of the folder it has open, so a video plays when it lies inside the presentation folder.
A shape whose video does not play shows its fill, and *Developer: Open Webview Developer Tools* in the command palette shows the failed address in its console.

A window opened at a folder above several presentations finds the folder of each presentation from its `package.json` as well, so it plays the videos of a presentation inside it.
Such a window takes the settings of the slides from the `.vscode/settings.json` of the folder it opened, so a presentation is edited with its own settings only in a window opened at its folder.

## Check the spelling and the grammar with LanguageTool on this machine

VS Code opens its windows with the spell check of the browser off, so the draw.io editor underlines nothing by itself.
LanguageTool, an open-source checker under the LGPL, runs on the Mac as a server that the editor plugin, `npm run check` and VS Code use, and no text leaves the machine.
Homebrew installs it with Java, and starts it now and at every login:

```sh
brew install languagetool
brew services start languagetool
```

The server answers at `http://localhost:8081`, for this Mac alone, and `brew services stop languagetool` stops it.
The setting `drawioSlides.languageTool` of the presentation names another address for the editor, for the command of the check and for `npm run check`, and the environment variable `LANGUAGETOOL_SERVER` names one for `npm run check` alone.

While a label is edited, `language-check.plugin.js` draws a wavy red line under a word that may be misspelt and a wavy blue line under a fault of grammar or of style.
The right button on an underlined word opens the message and up to five fixes, a fix replaces the word as typing would, so *Undo* takes it back, and *Ignore* hides the issue until the label is edited again.
A formula between `\(` and `\)` reads as the noun B, so its TeX is not checked, and the items of a list and the lines of a label read as paragraphs.
An item of a list may start with a small letter and end without a full stop, because the two rules of LanguageTool on them are left out.

`npm run check` checks every label of the deck the same way, one label at a time, and prints each issue with its slide, its page, its cell, the fixes and the words around it in brackets:

```
slide 47, conclusion-and-future-work-1, cell conclusion-and-future-work-1-future-work: spelling: Possible spelling mistake found.; Receiving, Receding
    ...ties [Receiding] horizon control, Markov process, and...
```

The command *Check the Spelling and Grammar of the Presentation* puts each issue into the Problems view, at the attribute `id` of its cell in its section file.
A label that several pages share, such as the steps of a slide, is checked once, and its issue sits at its first place.
Two lists hold the words that are right though LanguageTool does not know them.
A word for every document, such as a term of the field, goes into the list of the server, `spelling_custom.txt` in `org/languagetool/resource/en/hunspell/` of the installation of LanguageTool, such as `/opt/homebrew/opt/languagetool/libexec/` for Homebrew.
Every application that checks with the server reads the list, Firefox and VS Code among them, and the server reads it at its start, so a new word takes effect after `brew services restart languagetool`.
An upgrade of LanguageTool brings a new folder without the added words, so keep the list elsewhere and link it there.
A word of one deck alone, such as a name, goes into `language-check-words.txt` in the folder of the deck, one per line, which the editor plugin and the check of the deck read.

VS Code checks text, Markdown, LaTeX and the other formats of the extension LTeX+, `ltex-plus.vscode-ltex-plus`, against the same server, with these user settings:

```jsonc
"ltex.languageToolHttpServerUri": "http://localhost:8081",
"ltex.language": "en-US",
"ltex.enabled": ["bibtex", "context", "context.tex", "html", "latex", "markdown", "mdx", "typst",
  "asciidoc", "neorg", "org", "quarto", "restructuredtext", "rsweave", "plaintext"]
```

## Edit a slide as text, the way an agent does

Every slide is uncompressed XML: a `<diagram name="...">` per page, and inside it an `mxCell` per object.

- To add a slide, copy a whole `<diagram>` from the template of the presentation, `templates/slides.drawio.xml` by default, or from a section file, give it a new `name` and a new `id`, and put it where the slide goes.
- To change text, change the `value` attribute.
  The value is escaped HTML, so `<b>` is written `&lt;b&gt;`.
- To move an object, change `x` and `y` of its `mxGeometry`.
  The page is 1920 by 1080 with the origin at the top left.
- To add an object, copy an `mxCell` of the same kind, give it an `id` no other cell of the page has, and put it inside the `<root>` of the page.
  A cell later in the file is drawn on top.
- To give a cell a link or a video, wrap it in a `UserObject` that carries the properties, its `id` and its text as `label`, and drop the `id` and the `value` of the `mxCell`:

  ```xml
  <UserObject label="" video="assets/videos/demo.mp4" fit="crop" autoplay="1" muted="1" id="s5-video">
    <mxCell style="ellipse;html=1;" vertex="1" parent="1">
      <mxGeometry x="960" y="300" width="640" height="360" as="geometry" />
    </mxCell>
  </UserObject>
  ```

  A link to a page is `link="data:page/id,<id of the diagram>"`.
- After a change, run `npm run build` in the presentation folder and read its warnings.

An agent changes only the files in `sections/`, `assets/` and `templates/`, and `.vscode/settings.json` for a setting of the slides.
The page `every-construct-1` of the template shows each kind of object with the style keys that make it.
The skills in `skills/` of the extension give an agent the steps to start a deck, to build its HTML file and to build its PDF.

## The build warns about a slide it cannot show as intended

| warning or error | cause | what to do |
|---|---|---|
| `the name "x" starts slides 3, 7` | two slides apart from each other share a name | rename one, or move its pages next to the others |
| `slide 4, "x", has the steps 2, 1 in page order` | the steps of one slide are out of order | reorder the page tabs or rename the steps |
| `holds a formula and has mathematical typesetting off` | the switch of the page is off | *Extras > Mathematical Typesetting* on that page |
| `colors formulas with dpgren, which neither the page nor the setting drawioSlides.colors defines` | a name of a color that `drawioSlides.colors` lacks, often a typo | fix the name, or add the color to `drawioSlides.colors` |
| `drawioSlides.colors names a color "dp-red", which is not letters and digits that start with a letter, so the color is left out` | a name that TeX cannot read | rename the color, and the formulas that name it |
| `drawioSlides.colors gives accent the value "#04D80", which is not # and six hexadecimal digits, so the color is left out` | a value other than `#RRGGBB` | write the value as `#RRGGBB` |
| `drawioSlides.listStyles names the color acent, which drawioSlides.colors does not define, so the value stays as written` | a color of a level of the list styles that is a name `drawioSlides.colors` lacks, often a typo, or a name of CSS, such as `red`, which the marker still takes | fix the name, add the color to `drawioSlides.colors`, or write the value as `#RRGGBB` |
| `names the picture assets/a.png, which does not exist` | the path of a picture `image=assets/<name>` names no file | fix the path, relative to the presentation folder |
| `3-a.drawio.xml and 3-b.drawio.xml both carry the section number 3` | two files share a section number | renumber one of them |
| `notes.drawio.xml does not start with its section number` | a file in `sections/` without its number | name it `<number>-<name>.drawio.xml` |
| `page 3 was not ready within 15000 ms; exported as it stood and kept out of the cache` | the page did not finish drawing in time, or it shows `\(` or `$$` as text with mathematical typesetting on, which the export takes for a formula still to typeset, as the sources beside the constructs on the last three pages of the template do | look at the SVG of the page, and fix the page or set a longer `PAGE_WAIT` |
| `page 3 produced no SVG`, then `1 of 3 pages produced no SVG` | the viewer drew nothing, such as a viewer on the web without a network connection, and the build stops | fix the viewer or the connection, and build again |
| `the viewer v does not exist` | the path of `DRAWIO_VIEWER` names no file, and the build stops | name a file, or leave the variable out |
| `the viewer v lies outside the folder webapp of draw.io` | a copy of `viewer-static.min.js` outside the folder `webapp/js/` of draw.io, and the build stops | name the `viewer-static.min.js` in `webapp/js/` |
| `no browser started` or `the browser p did not start` | no Chromium of Playwright, Chrome or Edge starts, or the path of the browser names no browser, and the build stops | run *Install Chromium for the Build*, or set `drawioSlides.browserPath` or `--browser` to the program of a browser |
| `the cell x links to the page p, which the deck does not show` | a link to a page that is gone or hidden with `-hide` | link to a page of the deck |
| `the cell x has the link data:..., which only the editor follows` | a link of another kind of draw.io, such as an action | link to an address or a page |
| `a label links to the page p, which the deck does not show` | a link inside the text of a label to a page that is gone or hidden | link to a page of the deck |
| `a label has the link data:..., which only the editor follows` | a link of another kind inside the text of a label | link to an address or a page |
| `the cell x is no vertex, such as an edge, and the HTML file follows the link of a vertex alone` | a link on an edge | put the link on a shape or a text |
| `the video assets/videos/a.mp4 of the cell x does not exist` | the path of the property `video` names no file | fix the path, relative to the presentation folder |
| `the cell x has fit=y, which is none of contain, stretch, crop` | a value of `fit` that the HTML file does not know | write one of the three |
| `the cell x has barHideDelay=y, which is no time of 0 s or more, so it takes 0` | a time of the bar, `barHideDelay` or `barFadeOut`, that is no number of 0 or more | write a number of seconds |
| `the page assets/plots/a.html of the cell x does not exist`, from the HTML file, and `the page assets/plots/a.html of the cell x is missing, so the builds draw the cell as it is`, from the picture of the page | the path of the property `html` names no file | fix the path, relative to the presentation folder |
| `the page p of the cell x gave no picture, so the builds draw the cell with the picture of an earlier build`, or `as it is` | the page did not load within `SNAPSHOT_LOAD_WAIT`, or a page of another server had no network connection | open the page in a browser, fix what stops it, and build again |
| `the cell x of the page p is a rectangle shape, so the builds draw it as a rectangular picture of its page` | an embedded page in a shape other than `image` | give the shape the style `shape=image` |
| `two pages have the id p` | two pages share an id, usually after copying a page as text | give one of them a new `id` |
| `the key config of .../package.json holds "x", which is none of title, slides-dir, deck`, or `config.title of .../package.json holds [...], where a text was expected` | a key of `config` that the build does not know, or a value of the wrong kind, and the build stops | write the key as the section on the scripts above shows |
| `config.palette of .../package.json has moved to the setting drawioSlides.colors of .vscode/settings.json, which the command Import Colors from TeX writes from a TeX file` | a presentation whose `package.json` names the TeX files of its colors, and the build stops | import the colors of the files into `drawioSlides.colors`, as the section on colors says, and remove the key |
| `.../.vscode/settings.json holds the setting drawioSlides.colorDefinitions, whose colors the setting drawioSlides.colors has taken over` | a presentation whose settings name the TeX files of its colors, and the build stops | import the files, then remove `drawioSlides.colorDefinitions` |

## The six pages of the template

| page | what it carries |
|---|---|
| `title-slide-1` | the title over two lines, the date, the author and the affiliation, each centred, and no slide number |
| `section-divider-1` | a section title and the slide number |
| `title-and-body-1` | a title, a two-level bullet list with a formula inside one item, and the slide number |
| `every-construct-1` | one example of each construct, with its style keys beside it |
| `text-with-mathematics-1` | a formula inside a sentence, inside a list item, as a symbol set as text, at a size of its own, and on its own |
| `text-with-mathematics-2` | the same slide as its second step, titled *Text with mathematics in one cell continues* |

The set-up copies the first three into a new presentation.
The furniture of a slide is a title of 44 points at y 33, the slide number at the bottom right, and a body whose first level starts at x 486 and whose second starts at x 521.
The face is STIX Two Text throughout, apart from the slide number in Helvetica.

A bullet list is one `ul` with one `li` per item, and the marker is the `list-style-type` of its level.
A nested level is a `ul` inside its `li`, and each `li` carries the space between items as its `margin-top`.

The page `every-construct-1` draws twelve constructs:

- a text box of one line, and one of several lines with its own line height
- a rectangle, a rounded rectangle with an absolute corner radius, and an ellipse
- a path that matches no draw.io shape, as `shape=stencil(...)`
- an edge attached at both ends by a fraction along the side of its shape
- a curved edge with one waypoint, and an edge whose end carries a round terminal
- an equation label, a picture embedded as a data URI, and the slide-number cell

## The color configuration gives each hex value a name in the color dialog

draw.io shows a color as a hex value, and its configuration can give each value a name, so the color dialog offers `cdF`, the green of functionality of the codesign package, where it offered `#0E8005`.
A configuration carries three settings, and `deck-templates/named-colors.template.jsonc` is one to copy.

- `colorNames` gives a name to a hex value.
  The key is the value in upper case with no leading `#`.
  draw.io shows the name as a tooltip in the color dialog and matches it when you type there.
- `presetColors` fills the top row of that dialog, in the order given, with values in the same form.
- `customColorSchemes` adds rows of swatches to the top of the Style tab of the Format panel, before the rows of draw.io.
  A swatch takes `fill`, `stroke`, `font` and `gradient`, each a hex value with a leading `#`, or `none`.

A name does not travel with the drawing, because the style of a cell still holds the hex value.
A deck opened without the configuration therefore looks the same and shows hex values in place of the names.
A swatch sets the fill, the stroke and the font of everything selected at once, so a swatch of white on white makes the selection vanish from the page.
The mode `color-config` of the command line therefore gives each swatch a font that contrasts with its fill and leaves white out of both rows, and a configuration written by hand does the same.

The extension ignores a configuration pasted into draw.io and offers no dialog for one.
In VS Code a deck names its colors in the setting `drawioSlides.colors`, as the section on colors above says.
The extension adds those colors to `colorNames` and `presetColors` by itself, so the setting stays the one place of the colors of the deck.
A deck keeps `drawioSlides.customColorSchemes` alone, because a swatch sets a fill, a stroke and a font together, which no single color gives.
In a deck, each color of a swatch may be the name of a color of `drawioSlides.colors`, such as `"fill": "accent"`, so a swatch follows a change of the color.
A name that the setting does not define stays as written, with a line in the output channel of the extension.
In VS Code the three are settings of the extension, under the prefix `drawioSlides.` in `.vscode/settings.json`.
The mode `vscode` writes `drawioSlides.customColorSchemes` alone from a configuration in plain JSON, such as `named-colors-example.json` or a copy of `named-colors.template.jsonc` without its comments, as the section on VS Code above says.
A settings file that exists takes the setting by hand.
In the desktop and web applications, paste the three settings into *Extras > Configuration…*, save, and restart the application, which reads the configuration once at start.

The mode `color-config` of the command line writes the three settings from the colors a deck uses:

```sh
node <extension folder>/dist/cli.js color-config path/to/deck.drawio.xml \
    --out named-colors-deck.json \
    --definecolor <extension folder>/deck-templates/color-definitions.tex
```

An output file that ends in `.tex` gets the colors as `\definecolor` lines in the model `HTML` instead, which the import writes into `drawioSlides.colors`, to start the colors of a deck from the colors that its slides use:

```sh
# in the folder of the presentation
node drawio-slides.cjs color-config sections/1-opening.drawio.xml --out colors.tex
node drawio-slides.cjs from-tex colors.tex
```

A name of a hue there keeps its letters and digits alone, in lower case, such as `grey8b959e` for `Grey 8B959E`, and the name of a `\definecolor`, such as `cdF`, stays as written.
The colors are a start to edit by hand into a few colors named by their role, such as `accent` for the markers of the lists.

The mode keeps every color used at least `--least` times, eight by default.
The mode names a color that a file passed to `--definecolor` defines after the name of its `\definecolor`, such as `green`, and any other color after its hue.
A near-white color, of lightness above 0.9 and a chroma, the largest channel less the smallest, below 0.05, takes the name White, so a pale tint such as `#dae8fc` keeps the name of its hue.
A hue of one color gives it the plain name, such as `Blue`, and each color of a hue of several carries its hex value after the name, such as `Grey 8B959E`, so that no two names differ by a shade word alone.
`--definecolor` may be given more than once, such as for the colors of a deck that the export to TeX wrote and for a `.sty` file of the deck.
Run it again after the deck changes, because its output is generated.
