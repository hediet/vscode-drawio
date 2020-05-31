export function mapObject<TObj extends Record<string, any>, TResult>(
	obj: TObj,
	map: (item: TObj[keyof TObj], key: string) => TResult
): Record<keyof TObj, TResult> {
	const result: Record<keyof TObj, TResult> = {} as any;

	for (const [key, value] of Object.entries(obj)) {
		result[key as keyof TObj] = map(value as any, key);
	}

	return result;
}
