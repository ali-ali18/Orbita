import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { getItem, KEYS, setItem } from "../../lib/storage.ts";
import { ONBOARDING_DONE, ONBOARDING_PENDING, type OnboardingPhase, onboardingPhase } from "./model.ts";

/** `loading` enquanto o cofre não respondeu. Relê ao focar a tela, para a opção sumir depois de concluir. */
export function useOnboardingPhase(): OnboardingPhase | "loading" {
	const [phase, setPhase] = useState<OnboardingPhase | "loading">("loading");
	useFocusEffect(
		useCallback(() => {
			let cancelled = false;
			getItem(KEYS.onboarding)
				.then((value) => {
					if (!cancelled) setPhase(onboardingPhase(value));
				})
				.catch(() => {
					if (!cancelled) setPhase("available");
				});
			return () => {
				cancelled = true;
			};
		}, []),
	);
	return phase;
}

/** A pessoa tocou em começar nas boas-vindas: os passos abrem depois do pareamento. */
export async function markOnboardingPending(): Promise<void> {
	const current = await getItem(KEYS.onboarding);
	if (current === ONBOARDING_DONE) return;
	await setItem(KEYS.onboarding, ONBOARDING_PENDING);
}

export async function markOnboardingDone(): Promise<void> {
	await setItem(KEYS.onboarding, ONBOARDING_DONE);
}
