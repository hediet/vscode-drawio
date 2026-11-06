// Minimal types for the parts of markdown-it the Markdown editor uses
// (@types/markdown-it is not a dependency of this project).
declare module "markdown-it" {
	namespace MarkdownIt {
		interface Token {
			type: string;
			tag: string;
			level: number;
			nesting: number;
			map: [number, number] | null;
			content: string;
			info: string;
			children: Token[] | null;
			attrGet(name: string): string | null;
			attrSet(name: string, value: string): void;
		}

		interface Options {
			html?: boolean;
			linkify?: boolean;
			typographer?: boolean;
			breaks?: boolean;
		}

		type RenderRule = (
			tokens: Token[],
			idx: number,
			options: Options,
			env: any,
			self: Renderer
		) => string;

		interface Renderer {
			rules: Record<string, RenderRule | undefined>;
			render(tokens: Token[], options: Options, env: any): string;
			renderToken(tokens: Token[], idx: number, options: Options): string;
		}
	}

	class MarkdownIt {
		constructor(options?: MarkdownIt.Options);
		options: MarkdownIt.Options;
		renderer: MarkdownIt.Renderer;
		linkify: { set(options: { fuzzyLink?: boolean; fuzzyEmail?: boolean }): void };
		parse(src: string, env: any): MarkdownIt.Token[];
		render(src: string, env?: any): string;
	}

	export = MarkdownIt;
}
