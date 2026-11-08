import { useState } from "react";
import { View } from "react-native";
import { PairingForm } from "../pairing/PairingForm.tsx";
import { markOnboardingPending, useOnboardingPhase } from "./flag.ts";
import { WelcomeScreen } from "./WelcomeScreen.tsx";

/** Antes de parear: boas-vindas e o passo do servidor. Quem já configurou cai direto no pareamento. */
export function FirstRun() {
	const phase = useOnboardingPhase();
	const [started, setStarted] = useState(false);
	if (phase === "loading") return <View style={{ flex: 1 }} />;
	if (phase === "done" || started) {
		return <PairingForm setup={phase !== "done"} onBack={() => setStarted(false)} />;
	}
	return (
		<WelcomeScreen
			onStart={() => {
				void markOnboardingPending()
					.catch(() => {})
					.then(() => setStarted(true));
			}}
		/>
	);
}
