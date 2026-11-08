import { useLocalSearchParams } from "expo-router";
import { BanksStep } from "../features/onboarding/BanksStep.tsx";
import { BudgetStep } from "../features/onboarding/BudgetStep.tsx";
import { onboardingBankRows } from "../features/onboarding/model.ts";
import { NotificationsStep } from "../features/onboarding/NotificationsStep.tsx";
import { WelcomeScreen } from "../features/onboarding/WelcomeScreen.tsx";
import { PairingForm } from "../features/pairing/PairingForm.tsx";
import { HomePreview, InvoicePreview } from "../features/preview/ChangedScreens.tsx";

/** Prévia estática das telas de primeira vez, no navegador (390×844). */
export default function PreviaRoute() {
	const { tela } = useLocalSearchParams<{ tela?: string }>();
	const noop = () => {};
	switch (tela) {
		case "servidor":
			return <PairingForm setup preview initialCode="48291" />;
		case "bancos":
			return (
				<BanksStep
					rows={onboardingBankRows([])}
					onBack={noop}
					onConnect={noop}
					onContinue={noop}
					onSkip={noop}
				/>
			);
		case "notificacoes":
			return <NotificationsStep onBack={noop} onAllow={noop} onSkip={noop} />;
		case "orcamento":
			return <BudgetStep onBack={noop} onDone={noop} />;
		case "fatura":
			return <InvoicePreview />;
		case "inicio":
			return <HomePreview />;
		default:
			return <WelcomeScreen onStart={noop} />;
	}
}
