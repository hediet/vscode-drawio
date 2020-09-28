import { Uri, workspace, ConfigurationTarget, Disposable } from "vscode";
import { fromResource } from "../utils/fromResource";
import { computed, runInAction } from "mobx";
import { EventEmitter } from "@hediet/std/events";

export interface Serializer<T> {
	deserialize: (val: any) => T;
	serializer: (val: T) => any;
}

export function serializerWithDefault<T>(defaultValue: T): Serializer<T> {
	return {
		deserialize: (val) => (val === undefined ? defaultValue : val),
		serializer: (val) => val,
	};
}

export class VsCodeSetting<T> {
	public get T(): T {
		throw new Error();
	}

	public readonly serializer: Serializer<T>;
	public readonly scope: Uri | undefined;
	private readonly settingResource: VsCodeSettingResource;
	private readonly target: ConfigurationTarget | undefined;

	public constructor(
		public readonly id: string,
		options: {
			serializer?: Serializer<T>;
			scope?: Uri;
			target?: ConfigurationTarget;
		} = {}
	) {
		this.scope = options.scope;
		this.serializer = options.serializer || {
			deserialize: (val) => val,
			serializer: (val) => val,
		};

		this.target = options.target;
		this.settingResource = new VsCodeSettingResource(
			this.id,
			this.scope,
			this.target
		);
	}

	public get(): T {
		const result = this.settingResource.value;
		return this.serializer.deserialize(result);
	}

	public async set(value: T): Promise<void> {
		const value2 = this.serializer.serializer(value);
		const c = workspace.getConfiguration(undefined, this.scope);
		let target: ConfigurationTarget;
		if (this.target !== undefined) {
			target = this.target;
		} else {
			const result = c.inspect(this.id);
			if (
				result &&
				[
					result.workspaceFolderLanguageValue,
					result.workspaceFolderValue,
				].some((i) => i !== undefined)
			) {
				target = ConfigurationTarget.WorkspaceFolder;
			}
			if (
				result &&
				[result.workspaceLanguageValue, result.workspaceValue].some(
					(i) => i !== undefined
				)
			) {
				target = ConfigurationTarget.Workspace;
			} else {
				target = ConfigurationTarget.Global;
			}
		}

		await c.update(this.id, value2, target);
	}
}

class VsCodeSettingResource {
	public static onConfigChange = new EventEmitter();

	private readonly resource = fromResource<any>(
		(update) => {
			return VsCodeSettingResource.onConfigChange.sub(() => {
				update();
			});
		},
		() => this.readValue()
	);

	constructor(
		private readonly id: string,
		private readonly scope: Uri | undefined,
		private readonly target: ConfigurationTarget | undefined
	) {}

	private readValue(): any {
		const config = workspace.getConfiguration(undefined, this.scope);

		if (this.target === undefined) {
			return config.get(this.id);
		} else {
			const result = config.inspect(this.id);
			if (!result) {
				return undefined;
			}
			if (this.target === ConfigurationTarget.Global) {
				return result.globalValue;
			} else if (this.target === ConfigurationTarget.Workspace) {
				return result.workspaceValue;
			} else if (this.target === ConfigurationTarget.WorkspaceFolder) {
				return result.workspaceFolderValue;
			}
		}
	}

	/**
	 * This improves change detection.
	 */
	private readonly stringifiedSettingValue = computed(
		() => JSON.stringify(this.resource.current()),
		{
			name: `VsCodeSettingResource[${this.id}].value`,
			context: this,
		}
	);

	public get value() {
		const v = this.stringifiedSettingValue.get();
		if (v === undefined) {
			return undefined;
		}
		return JSON.parse(v);
	}
}

workspace.onDidChangeConfiguration(() => {
	runInAction("Update Configuration", () => {
		VsCodeSettingResource.onConfigChange.emit();
	});
});
