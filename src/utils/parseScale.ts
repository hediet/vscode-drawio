/**
 * Parses a user-provided PNG export scale/zoom factor.
 * Returns `undefined` if the input is not a finite number greater than 0.
 */
export function parseScale(input: string): number | undefined {
	const value = Number(input);
	return Number.isFinite(value) && value > 0 ? value : undefined;
}
