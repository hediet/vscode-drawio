---
name: deck-html
description: How an agent builds the HTML file of a draw.io deck with `npm run html`, adds a link, a video or an embedded HTML page to a slide as text, sets up the editor of a deck to play its videos and show its pages, and checks the HTML file before handing it over.
read-when:
  - building the HTML file of a draw.io slide deck, or handing a deck over as an HTML file
  - adding a link, a video, an embedded HTML page or an animated edge to a slide of a draw.io deck
---

# Build the HTML file of a deck, give its slides links and videos, and check it in a browser

A deck is a folder that the extension Draw.io Slides, the repository of this skill, set up, as `docs/presentations.md` of this repository says.
A path in this skill that starts at `build/`, `sections/` or `assets/` is relative to the folder of the deck.
Every other path is relative to `<extension folder>`, the folder of the installed extension or of a clone of this repository.
`docs/presentations.md` gives the properties of a link and of a video, the keys of the HTML file, the set-up of the editor plugins and the warnings of the build, and this skill does not restate them.

## Resources of this skill

This skill has no resource folder.
The skill uses the following files of the extension.

- `dist/cli.js` in its modes `html`, `build` and `watch` exports the slides, then writes the HTML file, and the launcher `drawio-slides.cjs` of each deck runs it.
  The export marks the shape of each cell with a video or a page in the SVG of its page, which the page of the HTML file needs to put the video or the page inside the shape.
  The mode reads the links, the videos and the embedded pages from the pages of the deck, and fills in `deck-templates/html-deck.html`.
  It copies the videos and the pages, with the files that a page names beside it, into `media/` beside the HTML file.
  Every build draws the cell of each embedded page as a picture of the page as it first draws, as the section on links, videos and pages of `docs/presentations.md` says.
- `deck-templates/html-deck.html` is the page of the HTML file, and its header says how a video or an embedded page sits inside its shape.
- `drawio-custom-plugins/slides/media-bar.js` holds the bars of controls of a video and of a page, which the editor and the HTML file share.
- `drawio-custom-plugins/slides/media.plugin.js` is the editor plugin that plays the videos and shows the embedded pages of the cells inside their shapes, and gives the selected one a bar of controls.

## Standard: the HTML file shows the deck as the build makes it, with its links and its videos

- The HTML file is `build/<deck folder>.html`, unless the user asks for another place, and every local video it plays is in `media/` beside it.
- The HTML file has one page per page of the deck that the build presents, in the order of the deck, as the PDF of the `deck-pdf` skill has.
- Every cell with a link opens its address or shows its page.
- Every cell with the property `video` plays its video inside its shape.
- Every cell with the property `html` shows its page inside its shape, and the page takes the pointer.
- The build prints no warning on a link or a video.
- The section files hold every link and every video, and nothing in `build/` is edited by hand.

## How-to: build the HTML file

1. In the folder of the deck, run `npm run html`.
   A deck whose `package.json` has no script `html` gets the script that the set-up writes, `"html": "node drawio-slides.cjs html"`.
   A deck whose scripts run `build-slides.py` of the draw.io presentation framework moves to the launcher first, with `node <extension folder>/dist/cli.js migrate`, as `docs/presentations.md` says.
2. Fix what the warnings of the build name, as the table of warnings of `docs/presentations.md` says.
3. To write the HTML file to another place, run `node drawio-slides.cjs html --html <file>` in the folder of the deck.
   The mode reads the title from the key `config` of the `package.json` of the deck, and the colours from `drawioSlides.colors` of its `.vscode/settings.json`, as the scripts of the deck do.
   The videos then go into `media/` beside that file.

## How-to: add a link, a video or an embedded page to a slide as text

1. Put the video file into `assets/videos/` of the deck, as MP4 with H.264 or as WebM with VP9.
   Put a page into a folder of `assets/`, such as `assets/plots/`, as one HTML file whose scripts are inside it or come from the web.
2. Wrap the cell in a `UserObject` with the properties, as the section on editing a slide as text of `docs/presentations.md` shows.
   A cell of a video is a shape whose outline the video takes, such as a rectangle, a rounded rectangle or an ellipse.
   A cell of a page has the style `shape=image`, as `docs/presentations.md` says.
3. Give the shape a still of the video as its fill, as a picture referenced as `assets/<name>`, when the deck is also handed over as a PDF.
4. Keep the shape at the same place and with the same `id` on every step of a slide in steps, so that the video plays on from one step to the next.
5. Run `npm run html` and read its warnings.

An edge whose style holds `flowAnimation=1` moves in the HTML file.

## How-to: set up the editor of a deck to play its videos

VS Code plays the videos of a deck when the extension `yujunhuang.drawio-slides` is installed and the `.vscode/settings.json` of the deck sets `drawioSlides.slides` to `true`.
The extension then loads the plugins that it ships, `media-bar.js` and `media.plugin.js` among them, without asking, and gives `media.plugin.js` the folder of the deck, the nearest folder above the drawing that holds a `package.json`.
A settings file that lacks a setting that the set-up writes gets it by hand, because the set-up replaces no settings file.
The shipped plugin `view-position.plugin.js` keeps the editor from writing the position of the view, the attributes `dx` and `dy` of `<mxGraphModel>`, into a page that it saves, and no option of draw.io or of the extension does the same.
A page that the editor does not show keeps the XML of its file.
A deck that gets `drawioSlides.slides` by hand therefore has `dx` and `dy` removed once from every `<mxGraphModel>` of its section files, with no other change to the files.

1. When the deck has no `.vscode/settings.json`, run `node <extension folder>/dist/cli.js vscode --colours <colour configuration>` in the folder of the deck.
   A deck that the set-up started has the file already.
   The mode writes the colours of the starting palette of the extension into `drawioSlides.colors`, and copies the template of the extension into `templates/` of the deck when the deck lacks it.
2. When `code --list-extensions` does not list `yujunhuang.drawio-slides`, tell the user to install the `.vsix` of the extension.

The section on VS Code of `docs/presentations.md` says which videos the editor plays.

## Required action: check the HTML file before handing it over

1. Open the HTML file in a headless Chromium, at the address of a slide with a video, such as `#12`.
   The Chromium that the build uses serves, driven through `playwright-core` in `node_modules/` of the extension.
2. Read in the page that every `<video>` sits inside a group `g[data-cell-id]` of the SVG, plays, and has the `object-fit` of its `fit`, `contain`, `fill` or `cover`.
   Read as well that every `iframe.cell-embed` sits inside such a group and that its page has loaded.
   Check with `document.elementFromPoint` at several points of each page, its corners as well as its centre, that the point reaches the `<iframe>`.
3. Take a screenshot of each slide with a video or a link, and look at it.
4. Press the key Right through every page, and check that the label at the bottom left reaches the last slide.
   The label reads the number of the last slide over the total, from the counts that the build prints, `N slides on P pages, and B backup slides on Q pages`.
   Without a backup section the label reads `<total>/<total>`, and with one `<last>/<total>-<total with backup>`.
   When the last slide has steps, `-<step>` follows the number of the slide, such as `3-2/3`, or `50-2/45-59` with a backup section.
   The number of presses before the label stops changing is the number of pages less one.
5. Say in the reply that the check ran in Chromium, and name the browser in which the user presents when the user has named one.

## Never-do

- Do not write a link or a video into the files of `build/`, because the build writes them again.
- Do not copy a plugin of the extension into a deck, because every deck loads the one that the extension ships.
