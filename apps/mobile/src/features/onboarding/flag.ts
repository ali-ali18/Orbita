import { useEffect, useState } from "react";
import { getItem, KEYS, setItem } from "../../lib/storage.ts";

/** `loading` enquanto o cofre não respondeu. */
export function useOnboardingDone(): "loading" | "yes" | "no" {
	const [done, setDone] = useState<"loading" | "yes" | "no">("loading");
	useEffect(() => {
		let cancelled = false;
		getItem(KEYS.onboarding)
			.then((value) => {
				if (!cancelled) setDone(value === "done" ? "yes" : "no");
			})
			.catch(() => {
				if (!cancelled) setDone("no");
			});
		return () => {
			cancelled = true;
		};
	}, []);
	return done;
}

export async function markOnboardingDone(): Promise<void> {
	await setItem(KEYS.onboarding, "done");
}
