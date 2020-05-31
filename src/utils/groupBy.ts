interface Group<TKey, TItem> {
	key: TKey;
	items: TItem[];
}

export function groupBy<TKey, T>(
	items: ReadonlyArray<T>,
	selectKey: (item: T) => TKey
): Map<TKey, Group<TKey, T>> {
	const map = new Map<TKey, Group<TKey, T>>();
	for (const item of items) {
		const key = selectKey(item);
		let group = map.get(key);
		if (!group) {
			group = { key, items: [] };
			map.set(key, group);
		}
		group.items.push(item);
	}
	return map;
}
