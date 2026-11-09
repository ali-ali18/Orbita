import { useLocalSearchParams } from "expo-router";
import { ChatEmptyPreview, ChatTalkPreview } from "../features/chat/ChatPreview.tsx";
import { BanksStep } from "../features/onboarding/BanksStep.tsx";
import { BudgetStep } from "../features/onboarding/BudgetStep.tsx";
import { onboardingBankRows } from "../features/onboarding/model.ts";
import { NotificationsStep } from "../features/onboarding/NotificationsStep.tsx";
import { WelcomeScreen } from "../features/onboarding/WelcomeScreen.tsx";
import { PairingForm } from "../features/pairing/PairingForm.tsx";
import { HomePreview, InvoicePreview } from "../features/preview/ChangedScreens.tsx";
import { NotificationsView } from "../features/settings/NotificationsScreen.tsx";
import { SubScreen } from "../features/settings/parts.tsx";

const NOW = Date.parse("2026-11-15T15:00:00Z");

/** Tela Notificações do celular com dados de mentira: `acesso` mostra o Android ainda sem permissão. */
function NotificationsPreview({ needsAccess }: { needsAccess: boolean }) {
	const noop = () => {};
	return (
		<SubScreen
			title="Notificações do celular"
			subtitle="As compras dos bancos entram na hora, sem esperar o Open Finance trazer."
		>
			<NotificationsView
				settings={{
					capture: true,
					apps: ["nubank", "inter", "santander", "mercadopago"],
					toReview: true,
					askFirst: false,
					active: true,
					inbox: 2,
				}}
				supported
				status={{
					granted: !needsAccess,
					queued: needsAccess ? 0 : 2,
					lastSentAt: NOW - 12 * 60_000,
					lastError: needsAccess ? null : "Sem conexão com o servidor.",
					authFailed: false,
				}}
				inbox={
					needsAccess
						? []
						: [
								{
									id: "n1",
									app: "nubank",
									title: "Compra aprovada",
									text: "Compra de R$ 10,00 APROVADA em LOJA Y para o cartão com final 7777",
									reason: "target",
									postedAt: "2026-11-15T14:00:00Z",
								},
								{
									id: "n2",
									app: "inter",
									title: "Aviso",
									text: "Algo aconteceu com R$ 20,00 na sua conta",
									reason: "format",
									postedAt: "2026-11-15T09:30:00Z",
								},
							]
				}
				now={NOW}
				onToggleCapture={noop}
				onToggleApp={noop}
				onToggleAskFirst={noop}
				onToggleToReview={noop}
				onOpenAccess={noop}
				onOpenAppInfo={noop}
				onRetry={noop}
				onDismiss={noop}
			/>
		</SubScreen>
	);
}

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
		case "notificacoes-celular":
			return <NotificationsPreview needsAccess={false} />;
		case "notificacoes-acesso":
			return <NotificationsPreview needsAccess />;
		case "orcamento":
			return <BudgetStep onBack={noop} onDone={noop} />;
		case "fatura":
			return <InvoicePreview />;
		case "inicio":
			return <HomePreview />;
		case "chat":
			return <ChatEmptyPreview />;
		case "conversa":
			return <ChatTalkPreview />;
		default:
			return <WelcomeScreen onStart={noop} />;
	}
}
