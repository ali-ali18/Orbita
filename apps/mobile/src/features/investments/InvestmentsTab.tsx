import { colors, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Button, Card, CardHeader, ErrorState, Icon, Skeleton, Text } from "../../ui/index.ts";
import { useChartView } from "./chart-view-store.ts";
import { GroupsCard } from "./GroupsCard.tsx";
import {
	classRows,
	institutionRows,
	monthYieldCard,
	type PositionRow,
	positionRow,
	totalYieldCard,
} from "./investments-model.ts";
import { PillTabs, PositionLine, YieldTile } from "./parts.tsx";
import { useInvestments } from "./queries.ts";

type GroupTab = "classes" | "institutions";
const GROUP_TABS = [
	{ id: "classes", label: "Classes" },
	{ id: "institutions", label: "Instituições" },
] as const;

/** Quantas posições aparecem no resumo; o resto fica em "Ver todas". */
const PREVIEW_POSITIONS = 3;

/**
 * A aba Investimentos do Início: patrimônio, rendimento do mês e total, Classes/Instituições (segurar o gráfico abre
 * "Ver como"), posições e entrada para a Evolução. Todo número vem da API; aqui só se formata.
 */
export function InvestmentsTab({ bottomPadding }: { bottomPadding: number }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { hidden } = usePrivacy();
	const query = useInvestments();
	const data = toLoadable(query);
	const [tab, setTab] = useState<GroupTab>("classes");
	const [classesView, setClassesView] = useChartView("classes");
	const [institutionsView, setInstitutionsView] = useChartView("institutions");
	const [refreshing, setRefreshing] = useState(false);

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await queryClient.invalidateQueries();
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<ScrollView
			directionalLockEnabled
			contentContainerStyle={{
				paddingHorizontal: spacing.lg,
				paddingTop: spacing.md,
				paddingBottom: bottomPadding,
				gap: spacing.md,
			}}
			refreshControl={
				<RefreshControl
					refreshing={refreshing}
					onRefresh={onRefresh}
					tintColor={colors.text}
					colors={[colors.text]}
					progressBackgroundColor={colors.surface2}
				/>
			}
		>
			{data.phase === "loading" ? (
				<View accessibilityLabel="Carregando investimentos" style={{ gap: spacing.md }}>
					<Skeleton width="60%" height={46} />
					<View style={{ flexDirection: "row", gap: spacing.md }}>
						<View style={{ flex: 1 }}>
							<Skeleton height={96} />
						</View>
						<View style={{ flex: 1 }}>
							<Skeleton height={96} />
						</View>
					</View>
					<Skeleton height={260} />
				</View>
			) : data.phase === "error" ? (
				<ErrorState message={data.message} onRetry={data.retry} />
			) : !data.data.hasData ? (
				<Card highlight={false} style={{ gap: spacing.lg, alignItems: "flex-start" }}>
					<Text variant="cardTitle" accessibilityRole="header">
						Conecte um banco com investimentos
					</Text>
					<Text variant="caption" tone="secondary">
						Saldo, rendimento e evolução aparecem aqui.
					</Text>
					<Button label="Conectar um banco" onPress={() => router.push("/configuracoes/bancos")} />
				</Card>
			) : (
				(() => {
					const d = data.data;
					const rows: PositionRow[] = d.positions.map((p) => positionRow(p, hidden));
					const total = money(d.totalCents, hidden, { sign: "never" });
					const notes = [
						d.withoutBalance > 0 ? `${d.withoutBalance} sem saldo informado` : null,
						d.foreignCurrency > 0 ? `${d.foreignCurrency} em outra moeda` : null,
					].filter(Boolean);
					return (
						<>
							<View style={{ gap: spacing.xs }}>
								<Text variant="body" tone="secondary">
									Patrimônio investido
								</Text>
								<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
									{total}
								</Text>
								{notes.length > 0 ? (
									<Text variant="caption" tone="secondary">
										{`Fora da soma: ${notes.join(", ")}`}
									</Text>
								) : null}
							</View>
							<View style={{ flexDirection: "row", gap: spacing.md }}>
								<YieldTile label="Rendimento no mês" y={monthYieldCard(d.yield.month, hidden)} />
								<YieldTile label="Rendimento total" y={totalYieldCard(d.yield.total, hidden)} />
							</View>
							<PillTabs options={GROUP_TABS} value={tab} onChange={setTab} />
							{tab === "classes" ? (
								<GroupsCard
									title="Por classe"
									rows={classRows(d.byClass, hidden)}
									total={total}
									view={classesView}
									onViewChange={setClassesView}
								/>
							) : (
								<GroupsCard
									title="Por instituição"
									rows={institutionRows(d.byInstitution, hidden)}
									total={total}
									view={institutionsView}
									onViewChange={setInstitutionsView}
								/>
							)}
							{rows.length > 0 ? (
								<Card style={{ gap: spacing.sm }}>
									<CardHeader
										title="Posições"
										{...(rows.length > PREVIEW_POSITIONS
											? { action: "Ver todas", onAction: () => router.push("/investimentos-posicoes") }
											: {})}
									/>
									{rows.slice(0, PREVIEW_POSITIONS).map((row) => (
										<PositionLine
											key={row.id}
											row={row}
											onPress={() => router.push({ pathname: "/investimento", params: { id: row.id } })}
										/>
									))}
								</Card>
							) : null}
							<Card
								label="Evolução do patrimônio e aportes por mês"
								onPress={() => router.push("/investimentos-evolucao")}
							>
								<View style={{ flexDirection: "row", alignItems: "center" }}>
									<Text variant="cardTitle" style={{ flex: 1 }}>
										Evolução
									</Text>
									<Icon name="seta-direita" size={18} color={colors.textTertiary} />
								</View>
							</Card>
						</>
					);
				})()
			)}
		</ScrollView>
	);
}
