import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { ErrorState, Sheet, SheetGroup, SheetRow, Skeleton, Text } from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { useAccounts } from "../summary/queries.ts";
import { Note, SubScreen } from "./parts.tsx";
import { ALERTS_SOON, defaultAccountLabel, selectableAccounts } from "./preferences-model.ts";
import { usePreferences, useUpdatePreferences } from "./preferences-queries.ts";
import { SettingsRow, SettingsSection, StaticSwitch } from "./SettingsRows.tsx";

/**
 * Tela "Preferências" (Figma 44:739). O que tem efeito de verdade fica ativo: a conta padrão do Novo lançamento.
 * Moeda, modo (escuro) e idioma só têm um valor hoje (BRL, escuro, português) e aparecem como informação. O que depende de
 * funções ainda não construídas (mês que começa em outro dia, semana, avisos) aparece esmaecido com "Em breve".
 * "Esconder valores ao abrir" fica em Configurações → Segurança.
 */
export function PreferencesScreen() {
	const preferencesQ = usePreferences();
	const accountsQ = useAccounts();
	const update = useUpdatePreferences();
	const [picking, setPicking] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const preferences = toLoadable(preferencesQ);
	const accounts = toLoadable(accountsQ);

	const choose = (defaultAccountId: string | null) => {
		setMessage(null);
		setPicking(false);
		update.mutate({ defaultAccountId }, { onError: (error) => setMessage(errorMessage(error)) });
	};

	const ready = preferences.phase === "ready" && accounts.phase === "ready";
	const failed = preferences.phase === "error" ? preferences : accounts.phase === "error" ? accounts : null;
	const current = preferences.phase === "ready" ? preferences.data.defaultAccountId : null;

	if (isUnreachableQuery(preferencesQ)) {
		return <ServerDownScreen onRetry={() => preferencesQ.refetch()} />;
	}

	return (
		<SubScreen title="Preferências">
			<SettingsSection title="Dinheiro">
				<SettingsRow title="Meu mês começa no dia" caption="Mude para o dia do seu salário" soon />
				<SettingsRow info title="Moeda" value="BRL · Real" />
				<SettingsRow title="Primeiro dia da semana" soon />
				{failed ? (
					<View style={{ padding: spacing.lg }}>
						<ErrorState
							message={failed.message}
							onRetry={() => {
								void preferencesQ.refetch();
								void accountsQ.refetch();
							}}
						/>
					</View>
				) : !ready ? (
					<View style={{ padding: spacing.lg }}>
						<Skeleton height={spacing.xl} />
					</View>
				) : (
					<SettingsRow
						last
						title="Conta padrão"
						caption="Já vem marcada em Novo lançamento"
						value={defaultAccountLabel(accounts.data.accounts, current)}
						onPress={() => setPicking(true)}
					/>
				)}
			</SettingsSection>
			{message ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert">
					{message}
				</Text>
			) : null}

			<SettingsSection title="Aparência">
				<SettingsRow info title="Modo" value="Escuro" />
				<SettingsRow info last title="Idioma" value="Português" />
			</SettingsSection>

			<SettingsSection title="Avisos">
				<SettingsRow
					title="Resumo semanal"
					caption="Toda segunda, 08:30"
					chevron={false}
					soon
					trailing={<StaticSwitch on />}
				/>
				<SettingsRow title="Alerta de orçamento" soon />
				<SettingsRow title="Lembrete de fatura" soon />
				<SettingsRow last title="Gastos fora do padrão" chevron={false} soon trailing={<StaticSwitch on />} />
			</SettingsSection>
			<Note icon="info" text={ALERTS_SOON} />

			<Sheet visible={picking} title="Conta padrão" onClose={() => setPicking(false)}>
				<View style={{ paddingBottom: spacing.md }}>
					<SheetGroup>
						<SheetRow
							label="Nenhuma"
							caption="Vale a primeira da lista"
							role="radio"
							selected={current === null}
							onPress={() => choose(null)}
						/>
						{(ready ? selectableAccounts(accounts.data.accounts) : []).map((a) => (
							<SheetRow
								key={a.id}
								label={a.name}
								role="radio"
								selected={current === a.id}
								onPress={() => choose(a.id)}
							/>
						))}
					</SheetGroup>
				</View>
			</Sheet>
		</SubScreen>
	);
}
