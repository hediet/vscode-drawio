---
name: deck-pdf
description: How an agent builds a PDF of a draw.io deck with `npm run pdf`, which prints the built SVGs with the slide numbers filled in and the hidden pages left out, and how the agent checks the PDF before handing it over.
read-when:
  - building a PDF of a draw.io slide deck, or handing a deck over as a PDF
---

# Build the PDF of a deck from its built slides, and check its pages, its numbers and its formulas

A deck is a folder that the extension Draw.io Slides, the repository of this skill, set up, as `docs/presentations.md` of this repository says.
A path in this skill that starts at `build/` is relative to the folder of the deck.
Every other path is relative to `<extension folder>`, the folder of the installed extension or of a clone of this repository.
`docs/presentations.md` gives the steps that start a presentation from the template and build it.

## Resources of this skill

This skill has no resource folder.
The skill uses one file of the extension.

- `dist/cli.js` in its modes `pdf` and `build` exports the slides, then prints the PDF, and the launcher `drawio-slides.cjs` of each deck runs it.
  The PDF holds one page per SVG of `build/slides/`, at the size of the slide, printed through the headless browser of the build.

## Standard: the PDF shows the deck as the build makes it

- The PDF has one page per page of the deck that the build presents, in the order of the deck.
- Each slide number and each total reads as the build fills in `%slide%` and `%slides%`.
- A page whose name ends in `-hide` is absent and takes no number, as the section on file names and page names of `docs/presentations.md` says.
- The total leaves out the slides of a section file whose name contains `backup-slides`, as the section on the slide number of the same guide says.
  Those slides go on with the numbers and show the total with the backup slides after a dash.
- The formulas render, and no page shows raw TeX.
- The bookmarks of the PDF have three levels: a section per section file, under it each slide at its first page, and under a slide in steps each of its pages, from the `build/outline.json` that the build writes.
- The PDF is `build/<deck folder>.pdf` in the folder of the deck, unless the user asks for another place.

## How-to: build the PDF

1. In the folder of the deck, run `npm run pdf`, or `npm run build`, which writes the HTML file as well.
   A deck whose `package.json` has no script `pdf` gets the script that the set-up writes, `"pdf": "node drawio-slides.cjs pdf"`.
   A deck whose scripts run `build-slides.py` of the draw.io presentation framework moves to the launcher first, with `node <extension folder>/dist/cli.js migrate`, as `docs/presentations.md` says.
2. Fix what the warnings of the build name, as the table of warnings of `docs/presentations.md` says.
3. To write the PDF to another place, run `node drawio-slides.cjs pdf --pdf <file>` in the folder of the deck.
   The mode reads the title from the key `config` of the `package.json` of the deck, and the colors from `drawioSlides.colors` of its `.vscode/settings.json`, as the scripts of the deck do.

The mode `pdf` needs a browser, the Chromium that the command *Draw.io Slides: Install Chromium for the Build* installs once for every deck, or Chrome or Edge.
When the build stops because no browser starts, tell the user to run that command, or pass the program of a browser with `--browser <path>`.

## Required action: check the PDF before handing it over

1. Read the page count and the page size with `pdfinfo build/<deck folder>.pdf`.
   The count equals the page count that the build printed.
2. List the slide numbers with `pdftotext build/<deck folder>.pdf - | grep -E '^[0-9]+/[0-9]+(-[0-9]+)?$'`, and check that they rise to the total and past it in the backup slides.
3. Render pages with `pdftoppm -r 40 -png build/<deck folder>.pdf <output folder>/page`, with an output folder outside the repository of the deck.
   Look at the title slide and at each page with formulas.
4. Print the bookmarks with `pdftohtml -xml -i -q -stdout build/<deck folder>.pdf`, and compare the `<outline>` part with the outline that `npm run outline` prints.
