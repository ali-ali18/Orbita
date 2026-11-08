import { useState } from "react";
import { Linking } from "react-native";
import { toLoadable } from "../../lib/loadable.ts";
import { useSession } from "../../lib/session.tsx";
import { CONNECT_OPEN_FAILED, connectErrorMessage, connectUrl } from "../banks/connect-model.ts";
import { usePluggyActions, usePluggyStatus } from "../banks/queries.ts";
import { TOTAL_SCOPE } from "../budget/budget-model.ts";
import { useSetBudget } from "../budget/queries.ts";
import { BanksStep } from "./BanksStep.tsx";
import { BudgetStep } from "./BudgetStep.tsx";
import { markOnboardingDone } from "./flag.ts";
import { bankRows } from "./model.ts";
import { NotificationsStep } from "./NotificationsStep.tsx";

type Step = "banks" | "notifications" | "budget";

/** Bancos, notificações e orçamento, depois do pareamento (Figma, passos 2 a 4). */
export function SetupFlow({ onFinished }: { onFinished: () => void }) {
	const [step, setStep] = useState<Step>("banks");
	const [notice, setNotice] = useState<string | null>(null);
	const status = toLoadable(usePluggyStatus());
	const { connect } = usePluggyActions();
	const { baseUrl } = useSession();
	const saveBudget = useSetBudget();
	const names =
		status.phase === "ready" ? status.data.connections.flatMap((c) => (c.label ? [c.label] : [])) : [];

	const finish = async (cents: number | null) => {
		if (cents !== null) {
			try {
				await saveBudget.mutateAsync({ scope: TOTAL_SCOPE, limitCents: cents });
			} catch {
				// O limite continua editável em Configurações. Não trava a entrada no app.
			}
		}
		await markOnboardingDone().catch(() => {});
		onFinished();
	};

	const openConnect = async () => {
		if (!baseUrl) return;
		try {
			const { path } = await connect.mutateAsync();
			const url = connectUrl(baseUrl, path);
			if (!url) throw new Error(CONNECT_OPEN_FAILED);
			await Linking.openURL(url);
		} catch (error) {
			setNotice(connectErrorMessage(error));
		}
	};

	if (step === "notifications") {
		return (
			<NotificationsStep
				onBack={() => setStep("banks")}
				onAllow={() => setStep("budget")}
				onSkip={() => setStep("budget")}
			/>
		);
	}
	if (step === "budget") {
		return <BudgetStep onBack={() => setStep("notifications")} onDone={(cents) => void finish(cents)} />;
	}
	return (
		<BanksStep
			rows={bankRows(names)}
			onBack={() => {}}
			onConnect={() => {
				setNotice(null);
				void openConnect();
			}}
			notice={notice}
			onContinue={() => setStep("notifications")}
			onSkip={() => setStep("notifications")}
		/>
	);
}
