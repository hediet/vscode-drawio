import { Disposable } from "@hediet/std/disposable";
import { autorun } from "mobx";
import { env, window } from "vscode";
import { Config } from "../Config";
import { DrawioEditorManager } from "../DrawioEditorManager";

export class InsiderFeedbackFeature {
	public readonly dispose = Disposable.fn();

	constructor(editorManager: DrawioEditorManager, config: Config) {
		this.dispose.track({
			dispose: autorun(() => {
				// this keeps the setting up to date.
				// TODO make this hack unnecessary!
				config.alreadyAskedToTest;
			}),
		});

		this.dispose.track(
			editorManager.onEditorOpened.sub(({ editor }) => {
				const { feedbackUrl } = config;
				if (feedbackUrl && !config.alreadyAskedToTest) {
					editor.onActivityDetected.sub(async () => {
						if (config.alreadyAskedToTest) {
							return;
						}

						const result = await window.showInformationMessage(
							`With your feedback on GitHub, the Draw.io extension version ${config.packageJson.version} can be released as stable soon!`,
							{ modal: false },
							{
								title: `Give Feedback ❤️`,
								action: () => {
									env.openExternal(feedbackUrl);
								},
							},
							{
								title: "Skip For This Build",
								action: () => {},
							}
						);

						config.markAskedToTest();
						if (result) {
							result.action();
						}
					});
				}
			})
		);
	}
}
