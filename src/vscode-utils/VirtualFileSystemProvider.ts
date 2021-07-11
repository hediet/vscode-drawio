import {
	FileSystemProvider,
	Event,
	Uri,
	FileStat,
	FileType,
	FileChangeEvent,
	EventEmitter,
	workspace,
	FileChangeType,
} from "vscode";
import { Disposable } from "@hediet/std/disposable";
import { BufferImpl } from "../utils/buffer";

export class DrawioFileSystemController {
	public readonly dispose = Disposable.fn();

	private readonly fs = new VirtualFileSystemProvider();
	public readonly scheme = "drawio";

	constructor() {
		this.dispose.track(
			workspace.registerFileSystemProvider(this.scheme, this.fs, {
				isCaseSensitive: true,
				isReadonly: false,
			})
		);
	}

	public getOrCreateFileForUri(uri: Uri): {
		file: File;
		didFileExist: boolean;
	} {
		return this.fs.getOrCreateFile(uri);
	}

	/*public getRandomFile(extensionWithDot: string): File {
		const id1 = new Date().getTime();
		const id2 = id++;
		return this.fs.getOrCreateFile(`/${id1}_${id2}${extensionWithDot}`);
	}*/
}

export class VirtualFileSystemProvider implements FileSystemProvider {
	private fileChangedEmitter = new EventEmitter<FileChangeEvent[]>();
	public readonly onDidChangeFile = this.fileChangedEmitter.event;

	private readonly files = new Map<string, File>();

	public getOrCreateFile(uri: Uri): { file: File; didFileExist: boolean } {
		const key = uri.toString();

		const f = this.files.get(key);
		if (f) {
			return { file: f, didFileExist: true };
		}

		const newFile = new File(uri, Uint8Array.from([]));
		newFile.onDidChangeFile(() =>
			this.fileChangedEmitter.fire([
				{ type: FileChangeType.Changed, uri: newFile.uri },
			])
		);
		this.files.set(key, newFile);
		return { file: newFile, didFileExist: false };
	}

	readFile(uri: Uri): Uint8Array | Thenable<Uint8Array> {
		return this.getOrCreateFile(uri).file.data;
	}

	writeFile(
		uri: Uri,
		content: Uint8Array,
		options: { create: boolean; overwrite: boolean }
	): void | Thenable<void> {
		return this.getOrCreateFile(uri).file.write(content);
	}

	stat(uri: Uri): FileStat {
		const f = this.getOrCreateFile(uri).file;
		return {
			type: FileType.File,
			ctime: 0,
			mtime: 0,
			size: f.data.length,
		};
	}

	watch(
		uri: Uri,
		options: { recursive: boolean; excludes: string[] }
	): Disposable {
		return Disposable.empty;
	}

	readDirectory(
		uri: Uri
	):
		| [string, import("vscode").FileType][]
		| Thenable<[string, import("vscode").FileType][]> {
		throw new Error("Method not implemented.");
	}

	createDirectory(uri: Uri): void | Thenable<void> {
		throw new Error("Method not implemented.");
	}

	delete(uri: Uri, options: { recursive: boolean }): void | Thenable<void> {
		throw new Error("Method not implemented.");
	}

	rename(
		oldUri: Uri,
		newUri: Uri,
		options: { overwrite: boolean }
	): void | Thenable<void> {
		throw new Error("Method not implemented.");
	}
}

export class File {
	private readonly fileChangedEmitter = new EventEmitter();
	public readonly onDidChangeFile = this.fileChangedEmitter.event;

	constructor(public readonly uri: Uri, public data: Uint8Array) {}

	public write(data: Uint8Array): void {
		this.data = data;
		this.fileChangedEmitter.fire(undefined);
	}

	public writeString(str: string): void {
		this.write(Uint8Array.from(BufferImpl.from(str, "utf-8")));
	}

	public readString(): string {
		return BufferImpl.from(this.data).toString("utf-8");
	}
}
