import { chart, colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import type {
	AccountBalancesView,
	CashFlowView,
	InvoicesOverviewView,
	SpendingDailyView,
} from "../../lib/api.ts";
import { money, monthName } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { BankLogo, ErrorState, LineChart, Ring, Text } from "../../ui/index.ts";
import { usagePercent } from "../card/card-model.ts";
import { accountsCountLabel, freshnessLabel, variation } from "./bank-cards-model.ts";
import { Frame, Placeholder } from "./SquareCards.tsx";
import { bankBadge } from "./summary-model.ts";

/*
 * Os quatro cards-resumo do Início que vêm do banco: Saldo em contas, Limite, Fluxo de caixa e Gasto do mês.
 * Cada um é um quadrado tocável que abre o detalhe. Só exibem o que a API devolveu.
 */

function Tile<T>({
	title,
	label,
	state,
	onPress,
	children,
}: {
	title: string;
	/** Frase para leitor de tela do toque ("Saldo em contas, abrir"). */
	label: string;
	state: Loadable<T>;
	onPress: () => void;
	children: (data: T) => ReactNode;
}) {
	const top = (
		<Text variant="cardTitle" tone="secondary" numberOfLines={2} style={{ flexShrink: 1 }}>
			{title}
		</Text>
	);
	return (
		<Frame label={label} onPress={onPress} top={top}>
			{state.phase === "loading" ? (
				<Placeholder label={title} />
			) : state.phase === "error" ? (
				<ErrorState message={state.message} onRetry={state.retry} />
			) : (
				<View style={{ paddingTop: spacing.md }}>{children(state.data)}</View>
			)}
		</Frame>
	);
}

/** Valor grande do quadrado, com legenda e (discreta) a idade da leitura. */
function Figure({
	value,
	caption,
	fresh,
	captionLines = 1,
}: {
	value: string;
	caption: string;
	fresh?: string | null;
	captionLines?: number;
}) {
	return (
		<View style={{ gap: 2 }}>
			<Text variant="numberMedium" adjustsFontSizeToFit numberOfLines={1}>
				{value}
			</Text>
			<Text variant="caption" tone="secondary" numberOfLines={captionLines}>
				{caption}
			</Text>
			{fresh ? (
				<Text variant="micro" tone="tertiary" numberOfLines={1}>
					{fresh}
				</Text>
			) : null}
		</View>
	);
}

const MAX_LOGOS = 4;

export function BalanceTile({
	state,
	now,
	hidden,
	onPress,
}: {
	state: Loadable<AccountBalancesView>;
	now: Date;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<Tile title="Saldo em contas" label="Saldo em contas, abrir" state={state} onPress={onPress}>
			{(data) => {
				const known = data.accounts.length - data.withoutBalanceCount;
				if (data.accounts.length === 0) {
					return <Figure value="—" caption="Nenhuma conta ainda" />;
				}
				const shown = data.accounts.slice(0, MAX_LOGOS);
				const extra = data.accounts.length - shown.length;
				return (
					<View style={{ gap: spacing.md }}>
						<View style={{ flexDirection: "row", alignItems: "center" }}>
							{shown.map((a, i) => (
								<View key={a.accountId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
									<BankLogo
										{...bankBadge({ name: a.name, bankCode: a.bankCode })}
										size={28}
										ring={colors.surface}
									/>
								</View>
							))}
							{extra > 0 ? (
								<Text variant="caption" tone="secondary" style={{ marginLeft: spacing.sm }}>
									+{extra}
								</Text>
							) : null}
						</View>
						<Figure
							value={known === 0 ? "—" : money(data.totalCents, hidden)}
							caption={
								known === 0 ? "O banco não informou o saldo" : accountsCountLabel(data.accounts.length)
							}
							fresh={freshnessLabel(data.oldestSyncedAt, now)}
						/>
					</View>
				);
			}}
		</Tile>
	);
}

export function LimitTile({
	state,
	now,
	hidden,
	onPress,
}: {
	state: Loadable<InvoicesOverviewView>;
	now: Date;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<Tile title="Limite" label="Limite dos cartões, abrir" state={state} onPress={onPress}>
			{({ limits, cards }) => {
				if (limits.cardsCounted === 0) {
					return (
						<Figure value="—" caption={cards.length === 0 ? "Nenhum cartão ainda" : "Limite não informado"} />
					);
				}
				const percent = usagePercent(limits.usedCents, limits.limitCents) ?? 0;
				const estimated = cards.some((c) => c.limit.source === "estimated");
				return (
					<View style={{ gap: spacing.md }}>
						<Ring percent={percent} size={64} stroke={8} label={`${percent}% do limite usado`}>
							<Text variant="bodyStrong">{`${percent}%`}</Text>
						</Ring>
						<Figure
							value={money(limits.availableCents, hidden, { sign: "never" })}
							caption="disponível"
							fresh={`usado ${money(limits.usedCents, hidden, { sign: "never" })}${estimated ? " · estimado" : ""}`}
						/>
						{!estimated && freshnessLabel(limits.oldestSyncedAt, now) ? (
							<Text variant="micro" tone="tertiary" numberOfLines={1}>
								{freshnessLabel(limits.oldestSyncedAt, now)}
							</Text>
						) : null}
					</View>
				);
			}}
		</Tile>
	);
}

export function CashFlowTile({
	state,
	month,
	hidden,
	onPress,
}: {
	state: Loadable<CashFlowView>;
	month: string;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<Tile title="Fluxo de caixa" label="Fluxo de caixa do mês, abrir" state={state} onPress={onPress}>
			{(data) => {
				const peak = Math.max(data.inCents, data.outCents, 1);
				const row = (label: string, cents: number, color: string, tone: "positive" | "primary") => (
					<View style={{ gap: 4 }}>
						<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
							<Text variant="caption" tone="secondary">
								{label}
							</Text>
							<Text variant="bodyStrong" tone={tone} numberOfLines={1} style={{ flexShrink: 1 }}>
								{money(cents, hidden, { sign: "never" })}
							</Text>
						</View>
						<View
							style={{
								height: 6,
								borderRadius: radius.sm,
								backgroundColor: colors.surface3,
								overflow: "hidden",
							}}
						>
							<View
								style={{
									width: `${Math.max(cents > 0 ? 4 : 0, Math.round((cents * 100) / peak))}%`,
									height: 6,
									borderRadius: radius.sm,
									backgroundColor: color,
								}}
							/>
						</View>
					</View>
				);
				return (
					<View style={{ gap: spacing.md }}>
						{row("Entrou", data.inCents, colors.positive, "positive")}
						{row("Saiu", data.outCents, chart.other, "primary")}
						<Text variant="micro" tone="tertiary">
							{monthName(month)}, nas contas
						</Text>
					</View>
				);
			}}
		</Tile>
	);
}

export function SpendingTile({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<SpendingDailyView>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<Tile title="Gasto do mês" label="Gasto do mês, abrir" state={state} onPress={onPress}>
			{(data) => {
				const peak = Math.max(
					1,
					data.current.at(-1)?.cumulativeCents ?? 0,
					data.previous.at(-1)?.cumulativeCents ?? 0,
				);
				const v = variation(data.variancePercent);
				return (
					<View style={{ gap: spacing.md }}>
						<LineChart
							height={56}
							pad={4}
							xMax={data.daysInMonth}
							yMax={peak}
							series={[
								{
									key: "previous",
									color: chart.other,
									dashed: true,
									points: data.previous.map((p) => ({ x: p.day, y: p.cumulativeCents })),
								},
								{
									key: "current",
									color: colors.text,
									endDot: true,
									points: data.current.map((p) => ({ x: p.day, y: p.cumulativeCents })),
								},
							]}
						/>
						<Figure
							value={money(data.spentCents, hidden, { sign: "never" })}
							caption={v.text}
							captionLines={2}
						/>
					</View>
				);
			}}
		</Tile>
	);
}
