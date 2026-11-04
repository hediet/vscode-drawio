import * as webpack from "webpack";
import fs = require("fs");
import path = require("path");
import { CleanWebpackPlugin } from "clean-webpack-plugin";
import * as CopyPlugin from "copy-webpack-plugin";

const r = (file: string) => path.resolve(__dirname, file);

/** A package of `node_modules/` that a bundle holds code of. */
interface BundledPackage {
	readonly name: string;
	readonly version: string;
	readonly license: string;
	/** The author that its package.json names, which stands for the copyright holder without a license file. */
	readonly author: string | undefined;
	/** The texts of its files LICENSE, LICENCE, COPYING and NOTICE, each with its name. */
	readonly files: readonly { name: string; text: string }[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;

/** The folder of the package that holds the file, the folder right below `node_modules/` or its scope. */
function packageFolder(file: string): string | undefined {
	const parts = file.split(path.sep);
	const at = parts.lastIndexOf("node_modules");
	if (at < 0 || at + 1 >= parts.length) {
		return undefined;
	}
	const length = parts[at + 1].startsWith("@") ? at + 3 : at + 2;
	return parts.slice(0, length).join(path.sep);
}

function readBundledPackage(folder: string): BundledPackage {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(folder, "package.json"), "utf8")
	);
	return {
		name: manifest.name,
		version: manifest.version,
		license:
			typeof manifest.license === "string"
				? manifest.license
				: "not named in its package.json",
		author:
			typeof manifest.author === "string"
				? manifest.author
				: manifest.author?.name,
		files: fs
			.readdirSync(folder)
			.filter((name) => LICENSE_FILE.test(name))
			.sort()
			.map((name) => ({
				name,
				text: fs.readFileSync(path.join(folder, name), "utf8").trim(),
			})),
	};
}

/**
 * Writes `dist/THIRD-PARTY-NOTICES.md`, with the name, the version, the license and the license
 * files of each package of `node_modules/` whose code a bundle of this file holds, so that the
 * vsix carries the notices that their licenses ask for. One instance serves every configuration,
 * and each compiler that finishes writes the packages of all the compilations so far.
 */
class ThirdPartyNoticesPlugin {
	private readonly folders = new Map<string, Set<string>>();

	constructor(private readonly target: string) {}

	public apply(compiler: webpack.Compiler): void {
		const bundle = compiler.options.output.path ?? compiler.context;
		compiler.hooks.compilation.tap("ThirdPartyNotices", (compilation) => {
			compilation.hooks.finishModules.tap("ThirdPartyNotices", (modules) => {
				const folders = new Set<string>();
				for (const module of modules) {
					const resource = (module as webpack.NormalModule).resource;
					const folder =
						resource === undefined ? undefined : packageFolder(resource);
					if (folder !== undefined) {
						folders.add(folder);
					}
				}
				this.folders.set(bundle, folders);
			});
		});
		compiler.hooks.done.tap("ThirdPartyNotices", () => this.write());
	}

	private write(): void {
		const packages = [
			...new Set([...this.folders.values()].flatMap((set) => [...set])),
		]
			.map(readBundledPackage)
			.sort((a, b) => a.name.localeCompare(b.name));
		const unique = packages.filter(
			(item, index) =>
				index === 0 ||
				item.name !== packages[index - 1].name ||
				item.version !== packages[index - 1].version
		);
		const sections = unique.map((item) =>
			[
				`## ${item.name} ${item.version}`,
				"",
				`License: ${item.license}.`,
				...(item.author === undefined ? [] : ["", `Author: ${item.author}.`]),
				...item.files.flatMap((file) => [
					"",
					`${file.name}:`,
					"",
					"```text",
					file.text,
					"```",
				]),
			].join("\n")
		);
		fs.mkdirSync(path.dirname(this.target), { recursive: true });
		fs.writeFileSync(
			this.target,
			[
				"# The packages whose code the files of dist/ bundle",
				"",
				"The build of Draw.io Slides writes this file with webpack.config.ts, from the packages of node_modules/ that the bundles hold, with the license files of each.",
				"",
				...sections.map((section) => section + "\n"),
			].join("\n")
		);
	}
}

const thirdPartyNotices = new ThirdPartyNoticesPlugin(
	r("./dist/THIRD-PARTY-NOTICES.md")
);

const extensionConfig: webpack.Configuration = {
	entry: r("./src/index"),
	output: {
		path: r("./dist/extension"),
		filename: "index.js",
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../../[resource-path]",
	},
	devtool: "source-map",
	target: "node",
	externals: {
		vscode: "commonjs vscode",
		fs: "commonjs fs",
		path: "commonjs path",
		http: "commonjs http",
		// Ships in node_modules/ of the extension, because it finds its own files beside its code.
		"playwright-core": "commonjs playwright-core",
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [
			{
				test: /\.html$/i,
				loader: "raw-loader",
			},
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: "ts-loader",
					},
				],
			},
		],
	},
	node: {
		__dirname: false,
	},
	plugins: [
		new CleanWebpackPlugin(),
		new webpack.EnvironmentPlugin({
			DEV: "0",
		}),
		// Without `as any`, I get "Excessive stack depth comparing types with TS 3.2"
		new webpack.IgnorePlugin({ resourceRegExp: /^canvas$/ }) as any,
		new CopyPlugin({
			patterns: [
				{ from: "./src/features/LiveshareFeature/assets", to: "." },
			],
		}),
		thirdPartyNotices,
	],
};

/**
 * The command line of the build of a deck, `dist/cli.js`, which runs without VS Code. It loads
 * `playwright-core` from `node_modules/` of the extension, as the extension does.
 */
const commandLineConfig: webpack.Configuration = {
	entry: r("./src/cli"),
	output: {
		path: r("./dist"),
		filename: "cli.js",
		libraryTarget: "commonjs2",
	},
	target: "node",
	externals: {
		"playwright-core": "commonjs playwright-core",
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [{ loader: "ts-loader" }],
			},
		],
	},
	node: {
		__dirname: false,
	},
	plugins: [
		new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true }),
		thirdPartyNotices,
	],
};

/**
 * Browser guest of the Markdown code block editor (see
 * src/codeblock-editor). A single classic script: the Markdown editor loads
 * the guest HTML via document.write and a plain <script src> is the least
 * surprising way to get code into it.
 */
const codeBlockEditorGuestConfig: webpack.Configuration = {
	entry: r("./src/codeblock-editor/guest/main.ts"),
	output: {
		path: r("./dist/codeblock-editor"),
		filename: "guest.js",
		devtoolModuleFilenameTemplate: "../../[resource-path]",
	},
	devtool: "source-map",
	target: "web",
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: "ts-loader",
						options: {
							configFile: r("./src/codeblock-editor/guest/tsconfig.json"),
							instance: "codeblock-editor-guest",
						},
					},
				],
			},
		],
	},
	plugins: [
		new CleanWebpackPlugin(),
		// Chunk URLs would resolve against the guest document's <base href>
		// (the Draw.io webapp folder), so keep everything in one file.
		new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
		thirdPartyNotices,
	],
};

module.exports = [extensionConfig, commandLineConfig, codeBlockEditorGuestConfig];
