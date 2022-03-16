import * as path2 from "path";

function getPath(): path2.PlatformPath {
	try {
		const rq = eval("req" + "uire");
		const obj = rq("path");
		if ("relative" in obj) {
			return obj;
		}
	} catch (e) {}

	return path2;
}

export const path = getPath();
