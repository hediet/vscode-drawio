// This is taken from https://github.com/chrisbottin/xml-formatter/blob/d985d2d14f1690d6499c43d71fd8dfd3958e24d6/index.js
// The original code is MIT licensed (Copyright 2019 Chris Bottin)

function newLine(output: any) {
	output.content += output.options.lineSeparator;
	let i;
	for (i = 0; i < output.level; i++) {
		output.content += output.options.indentation;
	}
}

function appendContent(output: any, content: any) {
	output.content += content;
}

function processNode(node: any, output: any, preserveSpace: boolean) {
	if (typeof node.content === "string") {
		processContentNode(node, output, preserveSpace);
	} else if (node.type === "Element") {
		processElement(node, output, preserveSpace);
	} else if (node.type === "ProcessingInstruction") {
		processProcessingIntruction(node, output, preserveSpace);
	} else {
		throw new Error("Unknown node type: " + node.type);
	}
}

function processContentNode(node: any, output: any, preserveSpace: boolean) {
	preserveSpace = true;
	if (node.content.trim() !== "" || preserveSpace) {
		if (!preserveSpace && output.content.length > 0) {
			newLine(output);
		}
		appendContent(output, node.content);
	}
}

function processElement(node: any, output: any, preserveSpace: boolean) {
	if (!preserveSpace && output.content.length > 0) {
		newLine(output);
	}

	appendContent(output, "<" + node.name);
	processAttributes(output, node.attributes);

	if (node.children === null) {
		// self-closing node
		appendContent(output, "/>");
	} else if (node.children.length === 0) {
		// empty node
		appendContent(output, "></" + node.name + ">");
	} else {
		appendContent(output, ">");

		output.level++;

		let nodePreserveSpace = node.attributes["xml:space"] === "preserve";

		if (!nodePreserveSpace && output.options.collapseContent) {
			const containsTextNodes = node.children.some(function (child: any) {
				return child.type === "Text" && child.content.trim() !== "";
			});

			if (containsTextNodes) {
				nodePreserveSpace = true;
			}
		}

		node.children.forEach(function (child: any) {
			processNode(child, output, preserveSpace || nodePreserveSpace);
		});

		output.level--;

		if (!preserveSpace && !nodePreserveSpace) {
			newLine(output);
		}
		appendContent(output, "</" + node.name + ">");
	}
}

function processAttributes(output: any, attributes: any) {
	Object.keys(attributes).forEach(function (attr) {
		appendContent(output, " " + attr + '="' + attributes[attr] + '"');
	});
}

function processProcessingIntruction(
	node: any,
	output: any,
	preserveSpace: boolean
) {
	if (output.content.length > 0) {
		newLine(output);
	}
	appendContent(output, "<?" + node.name);
	processAttributes(output, node.attributes);
	appendContent(output, "?>");
}

/**
 * Converts the given XML into human readable format.
 *
 * @param {String} xml
 * @param {Object} options
 *  @config {String} [indentation='    '] The value used for indentation
 *  @config {function(node)} [filter] Return false to exclude the node.
 *  @config {Boolean} [collapseContent=false] True to keep content in the same line as the element. Only works if element contains at least one text node
 *  @config {String} [lineSeparator='\r\n'] The line separator to use
 * @returns {string}
 */
export function canonicalizeXml(xml: string, options: any = {}): string {
	options = options || {};
	options.indentation = options.indentation || "    ";
	options.collapseContent = options.collapseContent === true;
	options.lineSeparator = options.lineSeparator || "\r\n";

	const parse = require("xml-parser-xo");
	const parsedXml = parse(xml, { filter: options.filter });
	const output = { content: "", level: 0, options: options };

	if (parsedXml.declaration) {
		processProcessingIntruction(parsedXml.declaration, output, false);
	}

	parsedXml.children.forEach(function (child: any) {
		processNode(child, output, false);
	});

	return output.content.replace(/\r\n/g, "\n");
}
