import { useState } from "react";
import { View } from "react-native";
import { useOnboardingDone } from "../features/onboarding/flag.ts";
import { SetupFlow } from "../features/onboarding/SetupFlow.tsx";
import { HomeScreen } from "../features/summary/HomeScreen.tsx";

export default function InicioRoute() {
	const done = useOnboardingDone();
	const [finished, setFinished] = useState(false);
	if (done === "loading") return <View style={{ flex: 1 }} />;
	if (done === "no" && !finished) return <SetupFlow onFinished={() => setFinished(true)} />;
	return <HomeScreen />;
}
