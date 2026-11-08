import { useState } from "react";
import { View } from "react-native";
import { PairingForm } from "../pairing/PairingForm.tsx";
import { useOnboardingDone } from "./flag.ts";
import { WelcomeScreen } from "./WelcomeScreen.tsx";

/** Antes de parear: boas-vindas e o passo do servidor. Quem já configurou cai direto no pareamento. */
export function FirstRun() {
	const done = useOnboardingDone();
	const [started, setStarted] = useState(false);
	if (done === "loading") return <View style={{ flex: 1 }} />;
	if (done === "yes" || started)
		return <PairingForm setup={done === "no"} onBack={() => setStarted(false)} />;
	return <WelcomeScreen onStart={() => setStarted(true)} />;
}
