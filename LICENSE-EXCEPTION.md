# Output exception to the GNU General Public License for Draw.io Slides

Copyright (C) 2026 Yujun Huang.

Draw.io Slides is free software under the GNU General Public License, version 3, in `LICENSE.md`, as the original extension hediet.vscode-drawio of Henning Dieterichs is.
Section 7 of that license lets the holder of the copyright of material added to a covered work grant additional permissions for that material.
As such an additional permission, Yujun Huang grants the permission below for the covered files that the next section names.

## The covered files are the files of Yujun Huang that reach a presentation

The covered files are the files of this repository whose copyright Yujun Huang holds and whose content the extension or its command line `dist/cli.js` writes or copies into a presentation or into its build:

| covered file | what of it reaches a presentation |
|---|---|
| `deck-templates/html-deck.html` | the whole page, in the HTML file of every build |
| `drawio-custom-plugins/slides/media-bar.js` | the whole script, in the HTML file of every build |
| `drawio-custom-plugins/slides/list-marker-rules.js` | the CSS rules of the list markers that it writes, in the SVG of each page with a list, and through the SVGs in the HTML file and the PDF |
| `drawio-custom-plugins/slides/mathjax-commands.tex` | the definitions of the commands that a page uses, in `build/assembled.drawio.xml` and through it in the drawing of the formulas |
| `deck-templates/slide-format.drawio.xml` | the pages that the set-up copies into the first section file and into `templates/slides.drawio.xml`, and the slides that the editor inserts from them |
| `deck-templates/color-definitions.tex` | the colours and their comments, in the setting `drawioSlides.colors` of `.vscode/settings.json` |
| `deck-templates/named-colors-example.json` | the swatches, in the setting `drawioSlides.customColorSchemes` when the set-up is given the file |
| `deck-templates/drawio-slides.cjs` | the whole launcher, in the folder of the presentation |
| `src/deck/deckSetUp.ts`, `src/deck/deckMigration.ts` | the text that the set-up and the move to the launcher write into `package.json`, `.gitignore` and `.vscode/settings.json` |
| `src/deck/colourSettings.ts`, `src/deck/colourConfig.ts` | the colours that the import of colours writes into `.vscode/settings.json`, the TeX file of the export of colours, and the colour configuration of the mode `color-config` |
| `src/deck/deckAssembly.ts`, `src/deck/texDefinitions.ts`, `src/deck/pageSnapshots.ts`, `src/deck/deckPictures.ts` | `build/assembled.drawio.xml` and `build/outline.json`, with the label of the TeX definitions of a page, the cells drawn as pictures of their embedded pages and the pictures of `assets/` written as data, which the mode `embed-pictures` also writes into the section files |
| `src/deck/slideExport.ts` | the marks of the cells with a video or a page, the style element and the white page that the export writes into the SVG of each page |
| `src/deck/htmlDeck.ts` | the deck as JSON in the HTML file, and the list `build/media/.deck-media.json` |
| `src/deck/logoPlacement.ts` | the cells of the logos that the mode `place-logos` writes into a section file |
| `drawio-custom-plugins/slides/list-styles.plugin.js` | the styles of the lists that it writes into a label that the editor saves |
| `drawio-custom-plugins/slides/insert-slide.plugin.js` | the name that it gives a slide that it inserts from a template |

The table lists the covered files at the time of this text.
Each covered file names this permission in its header, apart from `deck-templates/named-colors-example.json`, whose format, JSON, holds no comment.
A file of Yujun Huang that a later version of the extension writes or copies into a presentation in the same way is a covered file as well.

## The output of the extension is free of the license

The output is every file that the extension or its command line writes or copies for a presentation.
Examples are the HTML file, the PDF, the SVGs, the files of `build/media/` and `build/page-snapshots/`, the assembled file and the outline in `build/`, the section files that the set-up starts from the pages of the template, the copy of the template, the settings of the editor, `package.json`, `.gitignore` and the launcher.
The output includes the parts of the covered files that these files contain, as the table above names them.

The author of a presentation may use, change, share and sell the output under terms of the author's choice, which may keep the output closed, and without naming Draw.io Slides.
The content that the author adds to the output belongs to the author.

## The parts of the output that are not of Yujun Huang keep their own licenses

The permission covers the material of Yujun Huang alone.
A built deck holds parts of the following works of others, each under its own license:

| work | license | what of it a built deck holds |
|---|---|---|
| draw.io of JGraph, the submodule `drawio`, whose viewer `drawio/src/main/webapp/js/viewer-static.min.js` draws each page in the export | Apache License, version 2.0, in `drawio/LICENSE` | no code: the SVG of each page is the drawing that the viewer writes from the page of the author |
| MathJax, which draw.io bundles in `drawio/src/main/webapp/math4/` | Apache License, version 2.0 | no code: the SVG of a page with a formula holds the outlines of the glyphs that MathJax draws, as paths with ids such as `MJX-1-TEX-I-1D465` |
| STIX Two Text, the face of the slide template | SIL Open Font License, version 1.1 | the PDF embeds subsets of the face, and the HTML file loads the face from Google Fonts |
| Helvetica, the face of the slide numbers of the template | the license of the copy of the font on the machine that builds the deck | the PDF embeds a subset of that copy |
| the icon sets and stencil libraries of draw.io, in `drawio/src/main/webapp/img/` | the terms of `drawio/src/main/webapp/img/LICENSE`, whose restriction does not apply to end-user diagram output | the drawing of each stencil or icon that a slide uses |

The Apache License, version 2.0, allows the use, the reproduction and the sale of the drawing that the viewer writes and of the glyphs of MathJax, in closed form as well.
Its conditions in section 4 apply to a redistribution of the work itself or of a work derived from it, such as a copy of the viewer, which a built deck does not hold.
The SIL Open Font License, version 1.1, allows a document to embed the font, and its conditions apply to the font software itself, such as a sale of the font on its own.
The output holds no code or text of the original extension of Henning Dieterichs and its other contributors.
The GNU General Public License of that code therefore places no condition on the output.

## Draw.io Slides itself stays under the license

The permission does not cover Draw.io Slides itself, as it is distributed or as it is changed.
Draw.io Slides is the extension, its command line, its plugins, its templates and the other files of this repository, and a changed version of them stays under the GNU General Public License, version 3.

When you convey a changed version of Draw.io Slides, you may remove this permission from your version, as section 7 of the license allows.
The permission then still holds for the output of every version that keeps it.
