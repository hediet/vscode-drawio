import * as webpack from "webpack";
import path = require("path");
import { CleanWebpackPlugin } from "clean-webpack-plugin";
import * as CopyPlugin from "copy-webpack-plugin";

const r = (file: string) => path.resolve(__dirname, file);

module.exports = {
	entry: r("./src/index"),
	output: {
		path: r("./dist/extension"),
		filename: "index.js",
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../../[resource-path]",
	},
	devtool: "source-map",
	externals: {
		vscode: "commonjs vscode",
	},
	resolve: {
		extensions: [".ts", ".js"],
		fallback: {
			path: require.resolve("path-browserify"),
			fs: false,
		},
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
	],
} as webpack.Configuration;
