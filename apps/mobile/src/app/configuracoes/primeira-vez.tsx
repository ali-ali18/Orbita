import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useOnboardingPhase } from "../../features/onboarding/flag.ts";
import { SetupFlow } from "../../features/onboarding/SetupFlow.tsx";

/** Configuração inicial aberta pelas configurações. Se já foi feita, volta. */
export default function PrimeiraVezRoute() {
	const router = useRouter();
	const phase = useOnboardingPhase();

	useEffect(() => {
		if (phase !== "done") return;
		if (router.canGoBack()) router.back();
		else router.replace("/configuracoes");
	}, [phase, router]);

	if (phase === "loading" || phase === "done") return <View style={{ flex: 1 }} />;
	const leave = () => (router.canGoBack() ? router.back() : router.replace("/configuracoes"));
	return <SetupFlow onBack={leave} onFinished={leave} />;
}
