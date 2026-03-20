/**
 * Lock management for diagram blocks in Markdown files.
 *
 * Locks prevent accidental modification of diagram XML when editing the
 * Markdown source directly. The lock state is stored inline in the diagram
 * block syntax (e.g., ```drawio locked or <!-- drawio:start locked -->).
 */

import { findDiagramBlocks, buildDiagramBlock } from "./diagramParser";

/**
 * Toggles the lock state for a diagram block at the given line.
 * Returns updated text and new lock state, or null if no block found.
 */
export function toggleLockAtLine(
	text: string,
	line: number
): { text: string; locked: boolean } | null {
	const blocks = findDiagramBlocks(text);
	const block = blocks.find(b => line >= b.startLine && line <= b.endLine);

	if (!block) {
		return null;
	}

	const newLocked = !block.locked;
	const replacement = buildDiagramBlock(block.xml, block.format, newLocked, block.height, block.width);
	const newText = text.substring(0, block.index) + replacement + text.substring(block.index + block.fullMatch.length);

	return { text: newText, locked: newLocked };
}

/**
 * Checks whether a given line is inside a locked diagram block.
 */
export function isLineLocked(text: string, line: number): boolean {
	const blocks = findDiagramBlocks(text);
	const block = blocks.find(b => line >= b.startLine && line <= b.endLine);
	return block ? block.locked : false;
}

/**
 * Sets the lock state for a specific diagram block.
 */
export function setLockState(text: string, blockIndex: number, locked: boolean): string {
	const blocks = findDiagramBlocks(text);

	if (blockIndex < 0 || blockIndex >= blocks.length) {
		return text;
	}

	const block = blocks[blockIndex];
	const replacement = buildDiagramBlock(block.xml, block.format, locked, block.height, block.width);
	return text.substring(0, block.index) + replacement + text.substring(block.index + block.fullMatch.length);
}
