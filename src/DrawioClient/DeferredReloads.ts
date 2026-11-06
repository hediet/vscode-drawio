/**
 * Defers the reloads of the editors while the Configuration dialog writes the
 * settings: every settings write would reload each open editor, so while any
 * Apply runs, the reloads are recorded instead, and each editor that skipped
 * one reloads once when the last Apply is done (also after an error).
 */
export class DeferredReloads {
	private running = 0;
	private readonly skipped = new Set<() => void>();

	/**
	 * Returns true and records the given reload if an Apply runs, else false
	 * (the caller reloads as usual).
	 */
	public defer(reload: () => void): boolean {
		if (this.running > 0) {
			this.skipped.add(reload);
			return true;
		}

		return false;
	}

	/**
	 * Runs the writes of an Apply, then the recorded reloads if no other
	 * Apply runs.
	 */
	public async run<T>(writes: () => Promise<T>): Promise<T> {
		this.running++;

		try {
			return await writes();
		} finally {
			this.running--;

			if (this.running === 0) {
				const reloads = [...this.skipped];
				this.skipped.clear();

				for (const reload of reloads) {
					reload();
				}
			}
		}
	}

	/** Forgets the reload of a closed editor. */
	public forget(reload: () => void): void {
		this.skipped.delete(reload);
	}
}
