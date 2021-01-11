import { Disposable } from "@hediet/std/disposable";
import { startTimeout, EventTimer } from "@hediet/std/timer";
import { env, Uri, window } from "vscode";
import { Config } from "../Config";
import { DrawioEditorService } from "../DrawioEditorService";

export class ActivityTracking {
	public readonly dispose = Disposable.fn();

	constructor(
		editorManager: DrawioEditorService,
		private readonly config: Config
	) {
		const timer = new EventTimer(1000 * 10, "stopped");
		timer.onTick.one(() => {
			config.addUsageTime10Seconds();
			this.showFeedbackIfApplicable();
		});

		let timeout: Disposable | undefined = undefined;
		function onActivity() {
			if (timeout) {
				timeout.dispose();
			} else {
				timer.start();
			}
			const msIn1Minute = 1000 * 60 * 1;
			timeout = startTimeout(msIn1Minute, () => {
				timeout = undefined;
				timer.stop();
			});
		}

		this.dispose.track(
			editorManager.onEditorOpened.sub(({ editor }) => {
				editor.drawioClient.onInit.sub(() => {
					if (config.canAskForSponsorship) {
						config.markAskedForSponsorship();
						editor.drawioClient.onInvokeCommand.sub(
							({ command }) => {
								if (command === "openDonationPage") {
									env.openExternal(
										Uri.parse(
											"https://github.com/sponsors/hediet"
										)
									);
								}
							}
						);
						editor.drawioClient.askForDonations();
					}
				});

				onActivity();
				editor.drawioClient.onCursorChanged.sub(() => {
					onActivity();
				});
				editor.drawioClient.onFocusChanged.sub(({ hasFocus }) => {
					if (hasFocus) {
						onActivity();
					}
				});
			})
		);
	}

	private async showFeedbackIfApplicable(): Promise<void> {
		const { feedbackUrl, canAskForFeedback } = this.config;
		if (!canAskForFeedback || !feedbackUrl) {
			return;
		}
		this.config.markAskedToTest();

		const result = await window.showInformationMessage(
			`With your feedback on GitHub, the Draw.io extension version ${
				this.config.packageJson.versionName ||
				this.config.packageJson.version
			} can be released as stable soon!`,
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

		if (result) {
			result.action();
		}
	}
}
