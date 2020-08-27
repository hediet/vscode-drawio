import { DisposableLike, dispose } from "@hediet/std/disposable";
import { createAtom, _allowStateChanges } from "mobx";

function invariant(condition: boolean, message?: string) {}

export function fromResource<T>(
	subscriber: (sink: (newValue: T) => void) => DisposableLike
): IResource<T | undefined>;
export function fromResource<T>(
	subscriber: (sink: (newValue: T) => void) => DisposableLike,
	initialValue: T
): IResource<T>;
export function fromResource<T>(
	subscriber: (sink: (newValue: T) => void) => DisposableLike,
	initialValue: T | undefined = undefined
): IResource<T | undefined> {
	let isActive = false;
	let isDisposed = false;
	let value = initialValue;
	let disposable: DisposableLike;

	const initializer = () => {
		invariant(!isActive && !isDisposed);
		isActive = true;
		disposable = subscriber((newValue: T) => {
			_allowStateChanges(true, () => {
				value = newValue;
				atom.reportChanged();
			});
		});
	};

	const suspender = () => {
		if (isActive) {
			isActive = false;
			dispose(disposable);
		}
	};

	const atom = createAtom("ResourceBasedObservable", initializer, suspender);

	return {
		current: () => {
			invariant(
				!isDisposed,
				"subscribingObservable has already been disposed"
			);
			const isBeingTracked = atom.reportObserved();
			if (!isBeingTracked && !isActive)
				console.warn(
					"Called `get` of a subscribingObservable outside a reaction. Current value will be returned but no new subscription has started"
				);
			return value;
		},
		dispose: () => {
			isDisposed = true;
			suspender();
		},
		isAlive: () => isActive,
	};
}

export interface IResource<T> {
	current(): T;
	dispose(): void;
	isAlive(): boolean;
}
