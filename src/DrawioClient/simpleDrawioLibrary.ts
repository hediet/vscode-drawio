import { groupBy } from "../utils/groupBy";
import { DrawioLibraryData, DrawioLibrarySection, res } from "./DrawioTypes";

export function simpleDrawioLibrary(
	libs: DrawioLibraryData[]
): DrawioLibrarySection[] {
	function mapLib(lib: DrawioLibraryData) {
		return lib.data.kind === "value"
			? {
					title: res(lib.libName),
					data: lib.data.value,
			  }
			: {
					title: res(lib.libName),
					url: lib.data.url,
			  };
	}

	const groupedLibs = groupBy(libs, (l) => l.entryId);

	return [
		{
			title: res("Custom Libraries"),
			entries: [...groupedLibs.values()].map((group) => ({
				title: res(group.key),
				id: group.key,
				libs: group.items.map(mapLib),
			})),
		},
	];
}
