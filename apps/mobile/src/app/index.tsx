import { useState } from "react";
import { View } from "react-native";
import { useOnboardingPhase } from "../features/onboarding/flag.ts";
import { showsAutomaticSetup } from "../features/onboarding/model.ts";
import { SetupFlow } from "../features/onboarding/SetupFlow.tsx";
import { HomeScreen } from "../features/summary/HomeScreen.tsx";

export default function InicioRoute() {
	const phase = useOnboardingPhase();
	const [finished, setFinished] = useState(false);
	if (phase === "loading") return <View style={{ flex: 1 }} />;
	if (showsAutomaticSetup(phase) && !finished) return <SetupFlow onFinished={() => setFinished(true)} />;
	return <HomeScreen />;
}
