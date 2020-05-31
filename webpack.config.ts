import * as webpack from "webpack";
import path = require("path");
import { CleanWebpackPlugin } from "clean-webpack-plugin";

const r = (file: string) => path.resolve(__dirname, file);

module.exports = {
	target: "node",
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
			NODE_ENV: null,
		}),
		new webpack.IgnorePlugin(/^canvas$/),
	],
} as webpack.Configuration;
