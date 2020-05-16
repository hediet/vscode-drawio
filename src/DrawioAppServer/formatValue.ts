// TODO make generic and improve. Copied from my mobx logger.
export function formatValue(value: unknown, availableLen: number): string {
	switch (typeof value) {
		case "number":
			return "" + value;
		case "string":
			if (value.length + 2 <= availableLen) {
				return `"${value}"`;
			}
			return `"${value.substr(0, availableLen - 7)}"+...`;

		case "boolean":
			return value ? "true" : "false";
		case "undefined":
			return "undefined";
		case "object":
			if (value === null) {
				return "null";
			}
			if (Array.isArray(value)) {
				return formatArray(value, availableLen);
			} else {
				return formatObject(value, availableLen);
			}
		case "symbol":
			return value.toString();
		case "function":
			return `[[Function${value.name ? " " + value.name : ""}]]`;
		default:
			return "" + value;
	}
}

function formatObject(value: object, availableLen: number): string {
	let result = "{ ";
	let first = true;
	for (const [key, val] of Object.entries(value)) {
		if (!first) {
			result += ", ";
		}
		if (result.length - 5 > availableLen) {
			result += "...";
			break;
		}
		first = false;
		result += `${key}: ${formatValue(val, availableLen - result.length)}`;
	}
	result += " }";
	return result;
}

function formatArray(value: any[], availableLen: number): string {
	let result = "[ ";
	let first = true;
	for (const val of value) {
		if (!first) {
			result += ", ";
		}
		if (result.length - 5 > availableLen) {
			result += "...";
			break;
		}
		first = false;
		result += `${formatValue(val, availableLen - result.length)}`;
	}
	result += " ]";
	return result;
}
