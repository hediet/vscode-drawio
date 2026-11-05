---
name: deck-skeleton
description: How an agent starts a new draw.io deck: the current official logos on the title slide, placed as their brand guidelines say, the outline and the section dividers that repeat it, the conclusion and backup slides, the text still to write, and the look at the built slides.
read-when:
  - starting a new draw.io slide deck or the skeleton of a talk
  - adding, replacing or placing the logo of an organization on a slide of a draw.io deck
---

# Start a deck with the current logos, placed as their guidelines say, and with an outline that every section repeats

A deck is a folder that the extension DrawSlidesCode, the repository of this skill, set up.
A path in this skill that starts at `sections/`, `assets/`, `templates/` or `build/` is relative to the folder of the deck.
Every other path is relative to `<extension folder>`, the folder of the installed extension or of a clone of this repository.
`docs/presentations.md` gives the steps that start a deck, the pages of the template and the way an agent edits a slide as text.
A key of a style beside a link to a color of the deck, such as `fillColor` beside `deckFillColor`, takes its value from the link.
A new value of such a key therefore needs the link taken out as well, as the section on editing a slide as text of `docs/presentations.md` says.
The template of a deck is the first file of its setting `drawSlidesCode.templates` in `.vscode/settings.json`, `templates/slides.drawio.xml` by default, which the set-up copies from `deck-templates/slide-format.drawio.xml`.
A new deck is a git repository of its own, and the user makes its first commit and adds its remote, as the same guide says.
The git commands on the files of a deck run in the repository of the deck.

## Resources of this skill

This skill has no resource folder.
The skill uses two modes of the command line `dist/cli.js` of the extension, which the launcher `drawslidescode.cjs` of each deck runs.

- `place-logos` writes a row of logos into one page of a section file.
  Each logo is a PNG file, cropped to its pixels that are not transparent, resampled, and embedded as a PNG data URI.
  The logos get one height, sit on one horizontal line and spread with equal gaps.
  `node drawslidescode.cjs --help` gives its options and their defaults.
- `screenshots` writes a PNG of each built slide of a deck and contact sheets of twelve slides, through the headless browser of the build.

## Standard: the title slide carries the current official logo of each organization of the speaker, placed as its guidelines say

- Each logo is the latest version that its organization publishes.
  The file comes from the brand site of the organization, or from a page of the organization that links the official file.
- A logo keeps its proportions, its colors and its drawing.
  The only changes are the crop of a transparent margin and the resampling.
- The variant of each logo suits the background of the slide, such as the color or the black version on a white slide.
- The logos sit on one horizontal line with one height and equal gaps, unless a guideline asks for another arrangement.
- The logo of a university beside the logos of its units follows the rules of the university on that pairing.
  An example is the endorsed branding of MIT on https://brand.mit.edu/logos-marks.
- Each logo has at least the clear space and the size that its guidelines give.
- When a guideline asks for the full name of the institution, the slide carries the name, such as in the affiliation line.
- `assets/logos/` of the deck holds the original files.
  `assets/logos/sources.md` names for each file the organization, the URL of the download, the page that links it and the date of the download.

## Standard: the deck opens with an outline and closes with a conclusion

- The outline slide follows the title slide and lists the sections of the talk.
- Each section of the outline opens with a divider slide.
  The title of the divider is the title of the section.
  The divider repeats the outline with the current section in bold and the other sections in grey `#8b959e`.
- The last section of the outline holds a conclusion slide that sums up the key points of the talk.
- Backup slides follow the conclusion, behind a divider of their own that the outline leaves out.
- When the talk presents a paper or another document, the sections follow the sections of the document.

## Standard: text still to write says what goes on the slide, in the style of real text

- Text that the speaker still has to write names what the slide will show, such as a definition, a result, a figure or a table.
- Such text takes the markup of the real text of its cell, as the pages of the template show, and no color or style of its own, so the speaker overwrites it in place.

## Required action: start the deck with the set-up of the extension

1. When the user names no folder for the deck, ask the user where the deck goes, and wait for the answer.
2. Run `node <extension folder>/dist/cli.js init <deck folder> --title "<title>"`, or ask the user to run the command *DrawSlidesCode: Set Up a Presentation in This Folder* on the folder in VS Code.
   `code --list-extensions --show-versions` names the installed version of `yujunhuang.drawslidescode`, whose folder is `~/.vscode/extensions/yujunhuang.drawslidescode-<version>`.

## Required action: find the current logo and the guidelines of each organization before placing its logo

1. When the user names no organization for the logos of the title slide, ask the user which organizations the logos stand for, and wait for the answer.
2. When an earlier deck carries the logos of the same organizations, read its `assets/logos/sources.md` and open the pages that it names.
   `ls ../*/assets/logos/sources.md` from the folder of the deck lists the decks beside it with logos, and the user may name a deck elsewhere.
   Copy the cells of its logos and its original files when the pages offer no newer version.
3. Otherwise find the files and the guidelines, as the how-to on finding the logo files says.
4. Read the guidelines on the logo: the versions, the colors, the clear space, the size, and the placement beside other logos.

## Required action: look at every built slide before delivering the deck

1. Run `npm run build` in the folder of the deck, and fix what its warnings name, as the table of warnings of `docs/presentations.md` says.
2. Run `node drawslidescode.cjs screenshots --out <output folder>` in the folder of the deck, with an output folder outside the repository of the deck.
3. Look at the title slide at its full size and at every contact sheet.
   Check that no text runs past the page or into another cell, that the lists of all slides start at the same place, and that each logo has its clear space.

## How-to: find the official logo files of an organization

1. Search the web for the brand guidelines of the organization, its logo downloads and its brand assets.
2. Take the files from the first source that offers them, in this order:
   - the brand site of the organization
   - a page of the organization on logos or brand assets
   - a page of the parent institution that links the files of the unit
   - the logo in the header of the site of the organization
3. When a download needs a login of the user, ask the user to download the file, or take the same official file from a page of the organization that links it.
   Name both in `sources.md`.
4. Download each file into a new empty folder of its own, outside the repository of the deck.
   Extract an archive with a script that skips every name that starts with `/` or holds `..`.
5. Measure the box of the pixels of each file that are not transparent, to compare the variants and to find a transparent margin.
6. Look at each file, and choose the variant for the background of the slide.
   `place-logos` reads PNG files, so convert a logo that the organization offers in another format, such as SVG, to PNG at a height of at least three times its height on the slide.

For the units of MIT, https://brand.mit.edu/logos-marks names the files and the rules of their placement.

## How-to: place the logos on the title slide

1. Copy the original files into `assets/logos/` of the deck, under names of the form `<organization>-logo-<variant>.png`.
2. Order the logos as the guidelines of the largest organization show.
   The endorsed branding of MIT puts the logos of the units first and the MIT logo at the right end.
3. Run `place-logos` in the folder of the deck, with the logos from left to right:

   ```sh
   node drawslidescode.cjs place-logos sections/1-my-talk.drawio.xml title-slide-1 \
       title-logo-lab=assets/logos/lab-logo-color.png \
       title-logo-department=assets/logos/department-logo-color.png \
       title-logo-university=assets/logos/university-logo-black.png
   ```

   The defaults give logos 100 px high, centred on y 925 and spread from x 160 to x 1760, below the affiliation of the title slide of the template.
   The mode prints the place of each logo and the gap between two logos.
4. Compare the gap with the clear space of each guideline, such as the clear space of the MIT logo on https://brand.mit.edu/logos-marks.
5. Write `assets/logos/sources.md`.

## How-to: write the outline slide and the section dividers

1. Copy the page `title-and-body-1` of the template for the outline slide, name the copy `outline-1`, and title it Outline.
   Put the list of the sections into the body, at y 380 so that the list sits near the middle of the page.
2. For each section, copy the page `section-divider-1` of the template, name the copy `section-<key>-1`, and give it the title of the section.
   Add a cell in the style of the body of `title-and-body-1`, at x 486.62 and y 380, 932.66 wide, that holds the outline.
3. Write the outline in the list markup of the body of the template, with the current section and the other sections set as the standard on the outline says:

   ```html
   <div style="line-height: 40px"><ul style="margin: 0; padding-left: 26.07px; list-style-type: disclosure-closed">
   <li><font color="#8b959e">The first section</font></li>
   <li style="margin-top: 8.44px"><b>The current section</b></li>
   <li style="margin-top: 8.44px"><font color="#8b959e">The last section</font></li>
   </ul></div>
   ```

   The value of a cell holds this HTML escaped, as `docs/presentations.md` says.
   The marker of the first level is `disclosure-closed`, which the browser draws as a shape and not as a glyph of the font.
   The marker therefore has one size in the editor, the PDF and the HTML deck, whichever copy of STIX Two Text each one loads.
   The setting `drawSlidesCode.listStyles` of the extension gives the markers their color and size in the editor and in every build, so the markup leaves out the color and the size of the marker.
   The color of a level may name a color of the setting `drawSlidesCode.colors` of the deck, such as `accent`.
4. Give the backup slides a copy of `section-divider-1` named `section-backup-1`, with the title Backup slides and no outline.
5. Break an item of a body list with `<br>` at about 60 characters, because the template writes its lists on one line each and a longer line runs past the right edge of the body.

## Guidance

- Prefer the raster file of the highest resolution that the organization offers, because `place-logos` resamples it to three times its height on the slide.
- Prefer one kind of variant across the row, such as each logo with its word mark, so that the logos look alike in weight.

## Never-do

- Do not recolor, redraw, stretch or rebuild a logo.
- Do not crop a logo past its transparent margin.
- Do not take a logo from a site that collects the logos of other organizations.
- Do not sign in to a site with an account of the user to download a logo.
