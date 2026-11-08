import { spacing } from "@orbita/tokens";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { MonthChips } from "../features/card/MonthChips.tsx";
import { BanksStep } from "../features/onboarding/BanksStep.tsx";
import { BudgetStep } from "../features/onboarding/BudgetStep.tsx";
import { onboardingBankRows } from "../features/onboarding/model.ts";
import { NotificationsStep } from "../features/onboarding/NotificationsStep.tsx";
import { WelcomeScreen } from "../features/onboarding/WelcomeScreen.tsx";
import { PairingForm } from "../features/pairing/PairingForm.tsx";
import { Screen, Text } from "../ui/index.ts";

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
			return (
				<Screen fadeTop>
					<View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
						<Text variant="greeting">Faturas</Text>
						<MonthChips
							options={[
								{ month: "2026-09", status: "paga" },
								{ month: "2026-10", status: "paga" },
								{ month: "2026-11", status: "paga" },
								{ month: "2026-12", status: "aberta" },
							]}
							value="2026-12"
							onChange={noop}
						/>
						<Text variant="numberLarge">R$ 51,50</Text>
						<Text variant="caption" tone="secondary">
							Fecha 5 de dez · vence 12 de dez
						</Text>
						<Text variant="body">Kabum · 5/10 · estimada</Text>
						<Text variant="caption" tone="secondary">
							A parcela que o banco ainda não lançou entra na fatura do mês.
						</Text>
					</View>
				</Screen>
			);
		default:
			return <WelcomeScreen onStart={noop} />;
	}
}
