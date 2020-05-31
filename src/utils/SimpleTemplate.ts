export class SimpleTemplate {
	constructor(private readonly str: string) {}

	render(data: Record<string, () => string>): string {
		return this.str.replace(/\$\{([a-zA-Z0-9]+)\}/g, (substr, grp1) => {
			return data[grp1]();
		});
	}
}
