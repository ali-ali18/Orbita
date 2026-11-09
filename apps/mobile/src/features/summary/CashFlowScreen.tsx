import { colors, spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { CashFlowView } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { money, monthName } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Card, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { Notice } from "../card/parts.tsx";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { DetailScreen } from "./DetailScreen.tsx";
import { useCashFlow } from "./queries.ts";

function Row({
	label,
	cents,
	hidden,
	positive,
}: {
	label: string;
	cents: number;
	hidden: boolean;
	positive?: boolean;
}) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", minHeight: 36 }}>
			<Text variant="body" style={{ flex: 1 }}>
				{label}
			</Text>
			<Text variant="bodyStrong" tone={positive && cents > 0 ? "positive" : "primary"}>
				{money(cents, hidden, { sign: "never" })}
			</Text>
		</View>
	);
}

function Section({
	title,
	total,
	hidden,
	positive,
	rows,
}: {
	title: string;
	total: number;
	hidden: boolean;
	positive?: boolean;
	rows: readonly { label: string; cents: number }[];
}) {
	return (
		<Card>
			<Text variant="cardTitle" tone="secondary">
				{title}
			</Text>
			<Text
				variant="numberLarge"
				tone={positive && total > 0 ? "positive" : "primary"}
				adjustsFontSizeToFit
				numberOfLines={1}
				style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}
			>
				{money(total, hidden, { sign: "never" })}
			</Text>
			{rows.map((r) => (
				<Row
					key={r.label}
					label={r.label}
					cents={r.cents}
					hidden={hidden}
					{...(positive ? { positive } : {})}
				/>
			))}
		</Card>
	);
}

function Content({ data, hidden }: { data: CashFlowView; hidden: boolean }) {
	const nothing = data.inCents === 0 && data.outCents === 0;
	if (nothing) {
		return (
			<Text variant="body" tone="secondary">
				Nenhuma entrada nem saída nas contas neste mês ainda.
			</Text>
		);
	}
	return (
		<>
			<View style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
				<Text variant="cardTitle" tone="secondary">
					{data.netCents < 0 ? "Saiu mais do que entrou" : "Sobrou no mês"}
				</Text>
				<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
					{money(Math.abs(data.netCents), hidden, { sign: "never" })}
				</Text>
			</View>
			<Section
				title="Entrou nas contas"
				total={data.inCents}
				hidden={hidden}
				positive
				rows={[
					{ label: "Receitas", cents: data.in.incomeCents },
					{ label: "Estornos", cents: data.in.refundCents },
					{ label: "Resgates", cents: data.in.redemptionCents },
				]}
			/>
			<Section
				title="Saiu das contas"
				total={data.outCents}
				hidden={hidden}
				rows={[
					{ label: "Gastos", cents: data.out.expenseCents },
					{ label: "Pagamento de fatura", cents: data.out.cardPaymentCents },
					{ label: "Aplicações", cents: data.out.investedCents },
				]}
			/>
			{data.ignoredTransferCents > 0 ? (
				<Notice
					text={`${money(data.ignoredTransferCents, hidden, { sign: "never" })} em transferências entre as suas contas ficam fora dos dois lados.`}
				/>
			) : null}
			<View style={{ height: 1, backgroundColor: colors.border }} />
			<Text variant="caption" tone="secondary">
				Só as contas contam: compra no cartão entra aqui quando você paga a fatura.
			</Text>
		</>
	);
}

/** "Fluxo de caixa": o que entrou e saiu das contas no mês (`GET /v1/cash-flow/:mês`). */
export function CashFlowScreen() {
	const { month } = useClock();
	const { hidden } = usePrivacy();
	const query = useCashFlow(month);
	const flow = toLoadable(query);
	if (isUnreachableQuery(query)) return <ServerDownScreen onRetry={() => query.refetch()} />;
	return (
		<DetailScreen title="Fluxo de caixa" caption={monthName(month)}>
			{flow.phase === "loading" ? (
				<View accessibilityLabel="Carregando fluxo de caixa" style={{ gap: spacing.md }}>
					<Skeleton width="60%" height={46} />
					<Skeleton height={150} />
					<Skeleton height={150} />
				</View>
			) : flow.phase === "error" ? (
				<ErrorState message={flow.message} onRetry={flow.retry} />
			) : (
				<Content data={flow.data} hidden={hidden} />
			)}
		</DetailScreen>
	);
}
