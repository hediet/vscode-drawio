import { Uri, workspace, ConfigurationTarget, Disposable } from "vscode";
import { fromResource } from "mobx-utils";
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

	public constructor(
		public readonly id: string,
		options: {
			serializer?: Serializer<T>;
			scope?: Uri;
		} = {}
	) {
		this.scope = options.scope;
		this.serializer = options.serializer || {
			deserialize: (val) => val,
			serializer: (val) => val,
		};
		this.settingResource = new VsCodeSettingResource(this.id, this.scope);
	}

	public get(): T {
		const result = this.settingResource.value;
		return this.serializer.deserialize(result);
	}

	public async set(value: T): Promise<void> {
		const value2 = this.serializer.serializer(value);
		const c = workspace.getConfiguration(undefined, this.scope);
		const result = c.inspect(this.id);
		let target: ConfigurationTarget;

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

		await c.update(this.id, value2, target);
	}
}

class VsCodeSettingResource {
	public static onConfigChange = new EventEmitter();

	private subscription: Disposable | undefined;
	private readonly resource = fromResource<any>(
		(update) => {
			this.subscription = VsCodeSettingResource.onConfigChange.sub(() => {
				update(this.readValue());
			});
		},
		() => this.subscription!.dispose(),
		this.readValue()
	);

	constructor(
		private readonly id: string,
		private readonly scope: Uri | undefined
	) {}

	private readValue(): any {
		return workspace.getConfiguration(undefined, this.scope).get(this.id);
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
