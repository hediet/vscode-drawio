import { Disposable, TrackFunction } from "@hediet/std/disposable";
import { autorun } from "mobx";

export function autorunTrackDisposables(
	reaction: (track: TrackFunction) => void
): Disposable {
	let lastDisposable: Disposable | undefined;
	return {
		dispose: autorun(() => {
			if (lastDisposable) {
				lastDisposable.dispose();
			}
			lastDisposable = Disposable.fn(reaction);
		}),
	};
}
