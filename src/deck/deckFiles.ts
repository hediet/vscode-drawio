/**
 * The deck as a folder of section files, and the names that carry its order.
 *
 * One file per slide makes too many files and one file for the whole deck makes the draw.io
 * editor slow, so the deck is one file per section under `sections/`:
 *
 *     sections/3-uncertain-co-design.drawio.xml
 *              │ └── the section's name, for a reader
 *              └── the section number, which orders the files
 *
 *     a page of that file named   point-wise-probability-2
 *                                 │                     └── the step of the slide
 *                                 └── the name of the slide
 *
 * The pages present in the order of the files, and inside a file in the order of its pages, which
 * is the order of the page tabs in draw.io. Nobody numbers a slide by hand: the build counts
 * them. Pages that follow one another under one name are one slide shown in steps, which is how a
 * slide makes something appear or disappear, so they get one number and the number the audience
 * sees does not move while the slide builds.
 *
 *     page name                   slide number
 *     title-slide-1               1
 *     point-wise-probability-1    2
 *     point-wise-probability-2    2
 *     composition-1               3
 *
 * A name that comes back after another slide starts a new slide with a new number, because a
 * number that goes back down would confuse an audience, and `repeatedNames` reports it.
 * `stepProblems` reports a slide whose steps do not run 1, 2, 3. A name that ends in no
 * `-<step>` is step 1.
 *
 * A page whose name ends in `-hide`, such as `reset-metrics-example-1-hide`, stays in its file
 * and out of the deck: `shownPages` leaves it out before the slides are counted, so it takes no
 * number.
 *
 * A section file whose name contains `backup-slides`, such as `7-backup-slides.drawio.xml`, holds
 * backup slides, kept for questions after the talk. Its slides go on with the numbers, so each
 * still has a number of its own to ask for, and `mainTotal` leaves them out of the total, so the
 * total is the length of the talk. On a backup slide the build writes the total with the backup
 * slides after it: a deck of 40 slides and then 14 backup slides shows 20/40 on a slide of the
 * talk, and 41/40-54 to 54/40-54 on the backup slides.
 *
 * A deck without `sections/` is read from one multi-page file, `slides.drawio.xml`, as one
 * section. The key `config` of the deck's `package.json` names another slides folder or file, and
 * holds the title of the deck, as `readDeckConfig` says.
 */
import * as fs from "fs";
import * as path from "path";
import { DeckError } from "./deckError";
import { readTextFile, unescapeHtml } from "./textFormats";

export const SUFFIX = ".drawio.xml";
const FILE_NAME = /^(\d+)-(.+)$/;
const STEP = /^(.+)-(\d+)$/;
export const DIAGRAM = /<diagram [\s\S]*?<\/diagram>/g;
export const PAGE_NAME = /name="([^"]*)"/;

/** The slides folder of a deck when neither the command line nor its configuration names another. */
export const SLIDES_DIR = "sections";
/** The multi-page file of a deck when neither the command line nor its configuration names another. */
export const SINGLE_FILE = "slides.drawio.xml";
export const PACKAGE = "package.json";
/** The keys of `config` in `package.json` of a deck, each the long option of the command line of the same name. */
export const CONFIG_KEYS = ["title", "slides-dir", "deck"] as const;
export type ConfigKey = typeof CONFIG_KEYS[number];
/** A key that a deck no longer holds, with the place of what it held. */
const RETIRED_KEYS: Readonly<Record<string, string>> = {
	palette:
		"the setting drawioSlides.colors of .vscode/settings.json, which the command Import Colors from TeX writes from a TeX file",
};
const DEFAULTS: Readonly<Partial<Record<ConfigKey, string>>> = {
	"slides-dir": SLIDES_DIR,
	deck: SINGLE_FILE,
};

export const HIDDEN = "-hide";
export const BACKUP = "backup-slides";

/** One page of one section file. */
export interface DeckPage {
	readonly section: number;
	readonly sectionName: string;
	/** The place of the page among the pages of its file, from 0. */
	readonly position: number;
	readonly pageName: string;
	/** The name of the slide that the page shows a step of. */
	readonly name: string;
	readonly step: number;
	/** The text of the page, from `<diagram` to `</diagram>`. */
	readonly diagram: string;
	readonly source: string;
}

/** The facts of a deck that `config` of its `package.json` gives, each key optional. */
export type DeckConfig = Readonly<Partial<Record<ConfigKey, string>>>;

/** One numbered slide: its number, its name, and its pages, by their index in the deck. */
export interface Slide {
	readonly number: number;
	readonly name: string;
	readonly isBackup: boolean;
	readonly pages: readonly number[];
}

/** One section file in the deck, with its slides in order. */
export interface Section {
	readonly number: number;
	readonly name: string;
	readonly isBackup: boolean;
	readonly slides: readonly Slide[];
}

/** The slide numbers of the pages, by their index, and the total with the backup slides. */
export interface SlideNumbers {
	readonly numbers: readonly number[];
	readonly total: number;
}

/** A step problem: the slide, its name and the steps it has in page order. */
export interface StepProblem {
	readonly number: number;
	readonly name: string;
	readonly steps: readonly number[];
}

/** A page name's slide name and its step, which is the trailing number when there is one. */
export function splitStep(pageName: string): { name: string; step: number } {
	const match = STEP.exec(pageName);
	return match
		? { name: match[1], step: parseInt(match[2], 10) }
		: { name: pageName, step: 1 };
}

/** Whether the page is a backup slide, in a section file whose name contains `backup-slides`. */
export function isBackupPage(page: DeckPage): boolean {
	return page.sectionName.includes(BACKUP);
}

/** The pages of the text of one file as pages of the given section, in the order of their tabs. */
export function readPagesOfText(
	text: string,
	section: number,
	sectionName: string,
	source: string
): DeckPage[] {
	return (text.match(DIAGRAM) ?? []).map((diagram, position) => {
		const name = PAGE_NAME.exec(diagram);
		const pageName = name ? unescapeHtml(name[1]) : "slide-1";
		return {
			section,
			sectionName,
			position,
			pageName,
			...splitStep(pageName),
			diagram,
			source,
		};
	});
}

function readPages(
	file: string,
	section: number,
	sectionName: string
): DeckPage[] {
	return readPagesOfText(readTextFile(file), section, sectionName, file);
}

/** The pages of one section file, in the order the deck presents them. */
export function readSectionFile(file: string): DeckPage[] {
	const base = path.basename(file).slice(0, -SUFFIX.length);
	const match = FILE_NAME.exec(base);
	if (!match) {
		throw new DeckError(
			`${path.basename(file)} does not start with its section number`
		);
	}
	return readPages(file, parseInt(match[1], 10), match[2]);
}

/** The pages of a deck of one file, numbered as one section. */
export function readSingleFile(file: string): DeckPage[] {
	return readPages(file, 1, "slides");
}

/**
 * The key `config` of the `package.json` of a deck, or an empty configuration without the file.
 * The key holds the facts of the deck that its commands share, so that each is written once:
 * `{"title": "My talk", "slides-dir": "parts", "deck": "talk.drawio.xml"}`, each key optional. A
 * relative path is read from the deck folder.
 */
export function readDeckConfig(folder: string): DeckConfig {
	const file = path.join(folder, PACKAGE);
	if (!isFile(file)) {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw new DeckError(
			`${file} does not read as a JSON object: ${
				(error as Error).message
			}`
		);
	}
	if (!isPlainObject(parsed)) {
		throw new DeckError(
			`${file} does not read as a JSON object: it holds ${JSON.stringify(
				parsed
			)}`
		);
	}
	const config = parsed.config === undefined ? {} : parsed.config;
	if (!isPlainObject(config)) {
		throw new DeckError(
			`the key config of ${file} holds ${JSON.stringify(
				config
			)}, where an object was expected`
		);
	}
	for (const [key, value] of Object.entries(config)) {
		if (Object.prototype.hasOwnProperty.call(RETIRED_KEYS, key)) {
			throw new DeckError(
				`config.${key} of ${file} has moved to ${RETIRED_KEYS[key]}`
			);
		}
		if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
			throw new DeckError(
				`the key config of ${file} holds ${JSON.stringify(
					key
				)}, which is none of ${CONFIG_KEYS.join(", ")}`
			);
		}
		if (typeof value !== "string") {
			throw new DeckError(
				`config.${key} of ${file} holds ${JSON.stringify(
					value
				)}, where a text was expected`
			);
		}
	}
	return config as DeckConfig;
}

/**
 * The key `config` of the `package.json` of a deck as `readDeckConfig` reads it, or an empty
 * configuration when the file does not read as one, for a look at a folder that stops on no error.
 */
export function readDeckConfigOrDefaults(folder: string): DeckConfig {
	try {
		return readDeckConfig(folder);
	} catch (error) {
		if (error instanceof DeckError) {
			return {};
		}
		throw error;
	}
}

/**
 * The value of a key of `config`: the one given on the command line, or else the one of the
 * configuration, or else the default, which `title` lacks. An empty text counts as none.
 */
export function configSetting(
	key: ConfigKey,
	given: string | undefined,
	config: DeckConfig
): string | undefined {
	return given || config[key] || DEFAULTS[key] || undefined;
}

/** Where a deck reads its pages from: its slides folder, or else its multi-page file. */
export interface SlidesLocation {
	readonly location: string;
	readonly isFolder: boolean;
}

/**
 * The slides folder of a deck when it exists, or else its multi-page file when that exists, or
 * undefined when the deck holds neither.
 */
export function findSlidesLocation(
	folder: string,
	slidesDir: string,
	single: string
): SlidesLocation | undefined {
	const sections = path.join(folder, slidesDir);
	if (isFolder(sections)) {
		return { location: sections, isFolder: true };
	}
	const file = path.join(folder, single);
	return isFile(file) ? { location: file, isFolder: false } : undefined;
}

/**
 * Every page of every section file, in the order the deck presents them.
 * Two files of one section number would leave their order to chance, so they are refused.
 */
export function readSectionFolder(folder: string): DeckPage[] {
	const owners = new Map<number, string>();
	const pages = new Array<DeckPage>();
	for (const name of fs.readdirSync(folder).sort()) {
		if (!name.endsWith(SUFFIX)) {
			continue;
		}
		const found = readSectionFile(path.join(folder, name));
		if (found.length > 0) {
			const other = owners.get(found[0].section) ?? name;
			owners.set(found[0].section, other);
			if (other !== name) {
				throw new DeckError(
					`${other} and ${name} both carry the section number ${found[0].section}`
				);
			}
		}
		pages.push(...found);
	}
	return pages.sort((first, second) =>
		first.section !== second.section
			? first.section - second.section
			: first.position - second.position
	);
}

/** Whether the page is left out of the deck, its name ending in `-hide`. */
export function isHiddenPage(page: DeckPage): boolean {
	return page.pageName.endsWith(HIDDEN);
}

/** The pages that the deck presents, which are those whose name does not end in `-hide`. */
export function shownPages(pages: readonly DeckPage[]): DeckPage[] {
	return pages.filter((page) => !isHiddenPage(page));
}

/**
 * Whether each page starts a slide: its name differs from the page before it.
 * A slide whose steps run on into the next file stays one slide.
 */
export function slideStarts(pages: readonly DeckPage[]): boolean[] {
	return pages.map(
		(page, index) => index === 0 || page.name !== pages[index - 1].name
	);
}

/** The slide number of each page, by its index, and the deck's total with the backup slides. */
export function numberSlides(pages: readonly DeckPage[]): SlideNumbers {
	const starts = slideStarts(pages);
	const numbers = starts.reduce(
		(found, start) => [
			...found,
			(found[found.length - 1] ?? 0) + (start ? 1 : 0),
		],
		new Array<number>()
	);
	return { numbers, total: numbers[numbers.length - 1] ?? 0 };
}

/** The number of slides outside the backup sections, which is the total the deck shows. */
export function mainTotal(pages: readonly DeckPage[]): number {
	const { numbers } = numberSlides(pages);
	return new Set(
		numbers.filter((_number, index) => !isBackupPage(pages[index]))
	).size;
}

/**
 * The sections of the deck, each with its slides, and each slide with its pages.
 * A slide whose steps run on into the next file is listed in the file where it starts.
 */
export function deckOutline(pages: readonly DeckPage[]): Section[] {
	const { numbers } = numberSlides(pages);
	const starts = slideStarts(pages);
	const sections = new Array<{
		number: number;
		name: string;
		isBackup: boolean;
		slides: Slide[];
	}>();
	let slide:
		| { number: number; name: string; isBackup: boolean; pages: number[] }
		| undefined;
	pages.forEach((page, index) => {
		if (
			sections.length === 0 ||
			sections[sections.length - 1].number !== page.section
		) {
			sections.push({
				number: page.section,
				name: page.sectionName,
				isBackup: isBackupPage(page),
				slides: [],
			});
		}
		if (starts[index]) {
			slide = {
				number: numbers[index],
				name: page.name,
				isBackup: isBackupPage(page),
				pages: [],
			};
			sections[sections.length - 1].slides.push(slide);
		}
		slide!.pages.push(index);
	});
	return sections.filter((section) => section.slides.length > 0);
}

/** The pages of a section, by their index in the deck. */
export function sectionPages(section: Section): number[] {
	return new Array<number>().concat(
		...section.slides.map((slide) => slide.pages)
	);
}

/**
 * A title read from a page name or a section name: `point-wise-probability` becomes
 * `Point wise probability`.
 */
export function titleOf(name: string): string {
	const words = name.replace(/-/g, " ").trim();
	return words.slice(0, 1).toUpperCase() + words.slice(1) || name;
}

/** The names that start a slide more than once, each with the slide numbers it starts. */
export function repeatedNames(
	pages: readonly DeckPage[]
): Map<string, number[]> {
	const { numbers } = numberSlides(pages);
	const seen = new Map<string, number[]>();
	slideStarts(pages).forEach((start, index) => {
		if (start) {
			const name = pages[index].name;
			seen.set(name, [...(seen.get(name) ?? []), numbers[index]]);
		}
	});
	return new Map([...seen].filter(([_name, found]) => found.length > 1));
}

/** The slides whose steps do not run 1, 2, 3 in page order, each with the steps it has. */
export function stepProblems(pages: readonly DeckPage[]): StepProblem[] {
	const { numbers } = numberSlides(pages);
	const steps = new Map<number, { name: string; steps: number[] }>();
	pages.forEach((page, index) => {
		const found = steps.get(numbers[index]) ?? {
			name: page.name,
			steps: [],
		};
		steps.set(numbers[index], {
			name: found.name,
			steps: [...found.steps, page.step],
		});
	});
	return [...steps]
		.sort(([first], [second]) => first - second)
		.filter(([_number, found]) =>
			found.steps.some((step, index) => step !== index + 1)
		)
		.map(([number, found]) => ({
			number,
			name: found.name,
			steps: found.steps,
		}));
}

/** The name of the file of a section. */
export function sectionFileName(section: number, name: string): string {
	return `${section}-${name}${SUFFIX}`;
}

/** A name from a title, without its footnote markers, of as many whole words as fit. */
export function slug(text: string, length = 48): string {
	const plain = unescapeHtml(text).replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " ");
	let name = "";
	for (const word of plain.toLowerCase().match(/[A-Za-z0-9]+/g) ?? []) {
		const longer = name === "" ? word : `${name}-${word}`;
		if (longer.length > length && name !== "") {
			break;
		}
		name = longer.slice(0, length);
	}
	return name || "slide";
}

export function isFile(file: string): boolean {
	return fs.existsSync(file) && fs.statSync(file).isFile();
}

export function isFolder(folder: string): boolean {
	return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
}

export function isPlainObject(
	value: unknown
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
