import { spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Button, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { Note, SubScreen } from "../settings/parts.tsx";
import { SettingsRow, SettingsSection } from "../settings/SettingsRows.tsx";
import { paydayLine, sourceCaption } from "./income-model.ts";
import { useIncome } from "./queries.ts";

/**
 * Tela "Renda" (Configurações → Organização): o salário e outras entradas. Com a renda cadastrada, o Orçamento
 * monta o plano do mês e o Início mostra quando o salário cai. O que entra no mês e o próximo pagamento vêm do servidor.
 */
export function IncomeScreen() {
	const router = useRouter();
	const { hidden } = usePrivacy();
	const incomeQ = useIncome();
	const state = toLoadable(incomeQ);

	if (isUnreachableQuery(incomeQ)) return <ServerDownScreen onRetry={() => incomeQ.refetch()} />;

	const edit = (id: string) => router.push({ pathname: "/nova-renda", params: { id } });
	const add = () => router.push("/nova-renda");

	return (
		<SubScreen
			title="Renda"
			subtitle="Com o seu salário, a Órbita organiza o mês e nunca sugere gastar mais do que entra."
		>
			{state.phase === "loading" ? (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
					<Skeleton height={96} />
					<Skeleton height={96} />
				</View>
			) : state.phase === "error" ? (
				<ErrorState message={state.message} onRetry={state.retry} />
			) : state.data.sources.length === 0 ? (
				<>
					<Note
						icon="transferir"
						text="Cadastre o seu salário (valor líquido e dia do pagamento) para ver o plano do mês no Orçamento."
					/>
					<Button label="Cadastrar salário" onPress={add} />
				</>
			) : (
				<>
					<SettingsSection title="Neste mês">
						<SettingsRow
							info
							title="Entra neste mês"
							value={money(state.data.monthIncomeCents, hidden, { sign: "never" })}
						/>
						<SettingsRow
							info
							last
							title="Próximo pagamento"
							value={
								state.data.nextPayday
									? paydayLine(
											state.data.sources.find((s) => s.id === state.data.nextPayday?.sourceId)?.name ??
												"Renda",
											state.data.nextPayday.daysUntil,
										)
									: "Nenhum"
							}
						/>
					</SettingsSection>

					{[
						{ title: "Todo mês", list: state.data.sources.filter((s) => s.recurring) },
						{ title: "Avulsas", list: state.data.sources.filter((s) => !s.recurring) },
					]
						.filter((group) => group.list.length > 0)
						.map((group) => (
							<SettingsSection key={group.title} title={group.title}>
								{group.list.map((s, i) => (
									<SettingsRow
										key={s.id}
										title={s.name}
										caption={sourceCaption(s)}
										value={money(s.amountCents, hidden, { sign: "never" })}
										onPress={() => edit(s.id)}
										last={i === group.list.length - 1}
									/>
								))}
							</SettingsSection>
						))}

					<Button label="Adicionar renda" variant="secondary" icon="mais" onPress={add} />
					<Text variant="caption" tone="tertiary">
						Renda avulsa (um freela, por exemplo) conta só no mês escolhido.
					</Text>
				</>
			)}
		</SubScreen>
	);
}
