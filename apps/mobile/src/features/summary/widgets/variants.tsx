import { chart, colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import type {
	AccountBalancesView,
	CashFlowView,
	CategoriesView,
	InstallmentsView,
	InvoicesOverviewView,
	MonthSummary,
} from "../../../lib/api.ts";
import { money, percentOf } from "../../../lib/format.ts";
import type { Loadable } from "../../../lib/loadable.ts";
import { BankLogo, DonutChart, Ring, Text } from "../../../ui/index.ts";
import { usagePercent } from "../../card/card-model.ts";
import { Figure, FlowRow, Tile } from "../BankCards.tsx";
import { accountsCountLabel } from "../bank-cards-model.ts";
import { LoadableCard } from "../LoadableCard.tsx";
import { bankBadge, categoryShares, installmentsOverview } from "../summary-model.ts";
import { nextDueText } from "../wallet-model.ts";

/*
 * As versões de cada widget que não existiam como bloco do Início: as largas e baixas (2x4), as altas (4x4) e o
 * quadrado da rosca (2x2). Todas só exibem o que a API devolveu; nenhuma faz conta de dinheiro além de somar
 * inteiros que o servidor já mandou separados.
 */

const MAX_ROWS = 5;

/** Uma linha de rótulo e valor (caption à esquerda, valor em destaque à direita). */
function Pair({ label, value }: { label: string; value: string }) {
	return (
		<View
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				alignItems: "baseline",
				gap: spacing.md,
			}}
		>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
			<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
				{value}
			</Text>
		</View>
	);
}

/** Barra fina de uso (0 a 100%). */
function Bar({ percent }: { percent: number }) {
	return (
		<View
			style={{ height: 6, borderRadius: radius.sm, backgroundColor: colors.surface3, overflow: "hidden" }}
		>
			<View
				style={{
					width: `${Math.min(100, Math.max(percent > 0 ? 4 : 0, percent))}%`,
					height: 6,
					borderRadius: radius.sm,
					backgroundColor: colors.text,
				}}
			/>
		</View>
	);
}

// ------------------------------------------------------------------ faturas

export function WalletWide({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<InvoicesOverviewView>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<LoadableCard title="Faturas" state={state} skeletonLines={2} chevron onPress={onPress} gap={spacing.xs}>
			{(data) => (
				<View style={{ gap: spacing.xs }}>
					<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1}>
						{money(data.owedCents, hidden, { sign: "never" })}
					</Text>
					<Text variant="caption" tone="secondary">
						{data.cards.length === 0 ? "Nenhum cartão ainda" : nextDueText(data.nextDueDate)}
					</Text>
				</View>
			)}
		</LoadableCard>
	);
}

// -------------------------------------------------------------------- saldo

const logoOf = (a: AccountBalancesView["accounts"][number]) =>
	bankBadge({ name: a.name, bankCode: a.bankCode });

export function BalanceWide({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<AccountBalancesView>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<LoadableCard
			title="Saldo em contas"
			state={state}
			skeletonLines={2}
			chevron
			onPress={onPress}
			gap={spacing.xs}
		>
			{(data) => {
				const known = data.accounts.length - data.withoutBalanceCount;
				const shown = data.accounts.slice(0, 4);
				return (
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
						<View style={{ flex: 1 }}>
							<Figure
								value={known === 0 ? "—" : money(data.totalCents, hidden)}
								caption={
									known === 0 ? "O banco não informou o saldo" : accountsCountLabel(data.accounts.length)
								}
							/>
						</View>
						<View style={{ flexDirection: "row" }}>
							{shown.map((a, i) => (
								<View key={a.accountId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
									<BankLogo {...logoOf(a)} size={32} ring={colors.surface} />
								</View>
							))}
						</View>
					</View>
				);
			}}
		</LoadableCard>
	);
}

export function BalanceTall({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<AccountBalancesView>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<LoadableCard title="Saldo em contas" state={state} skeletonLines={5} chevron onPress={onPress}>
			{(data) => {
				const known = data.accounts.length - data.withoutBalanceCount;
				const shown = data.accounts.slice(0, MAX_ROWS);
				const extra = data.accounts.length - shown.length;
				return (
					<View style={{ gap: spacing.lg }}>
						<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1}>
							{known === 0 ? "—" : money(data.totalCents, hidden)}
						</Text>
						<View style={{ gap: spacing.md }}>
							{shown.map((a) => (
								<View
									key={a.accountId}
									style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
								>
									<BankLogo {...logoOf(a)} size={32} ring={colors.surface} />
									<Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
										{a.name}
									</Text>
									<Text variant="bodyStrong" numberOfLines={1}>
										{a.balanceCents === null ? "—" : money(a.balanceCents, hidden)}
									</Text>
								</View>
							))}
							{extra > 0 ? (
								<Text variant="caption" tone="secondary">
									+{extra} {extra === 1 ? "conta" : "contas"}
								</Text>
							) : null}
						</View>
					</View>
				);
			}}
		</LoadableCard>
	);
}

// ------------------------------------------------------------------- limite

export function LimitWide({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<InvoicesOverviewView>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<LoadableCard title="Limite" state={state} skeletonLines={2} chevron onPress={onPress}>
			{({ limits, cards }) => {
				if (limits.cardsCounted === 0) {
					return (
						<Figure value="—" caption={cards.length === 0 ? "Nenhum cartão ainda" : "Limite não informado"} />
					);
				}
				const percent = usagePercent(limits.usedCents, limits.limitCents) ?? 0;
				return (
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xl }}>
						<Ring percent={percent} size={64} stroke={8} label={`${percent}% do limite usado`}>
							<Text variant="bodyStrong">{`${percent}%`}</Text>
						</Ring>
						<View style={{ flex: 1, gap: spacing.sm }}>
							<Pair label="Usado" value={money(limits.usedCents, hidden, { sign: "never" })} />
							<Pair label="Disponível" value={money(limits.availableCents, hidden, { sign: "never" })} />
						</View>
					</View>
				);
			}}
		</LoadableCard>
	);
}

export function LimitTall({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<InvoicesOverviewView>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<LoadableCard title="Limite" state={state} skeletonLines={5} chevron onPress={onPress}>
			{({ limits, cards }) => {
				if (cards.length === 0) return <Figure value="—" caption="Nenhum cartão ainda" />;
				const percent = usagePercent(limits.usedCents, limits.limitCents);
				return (
					<View style={{ gap: spacing.lg }}>
						<View style={{ gap: 2 }}>
							<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1}>
								{limits.cardsCounted === 0 ? "—" : money(limits.availableCents, hidden, { sign: "never" })}
							</Text>
							<Text variant="caption" tone="secondary">
								{limits.cardsCounted === 0 ? "Limite não informado" : "disponível"}
							</Text>
						</View>
						<View style={{ gap: spacing.lg }}>
							{cards.slice(0, MAX_ROWS).map(({ card, limit }) => {
								const used = usagePercent(limit.usedCents, limit.limitCents);
								return (
									<View key={card.id} style={{ gap: spacing.xs }}>
										<Pair
											label={card.name}
											value={
												limit.limitCents === null
													? "Sem limite"
													: money(limit.usedCents, hidden, { sign: "never" })
											}
										/>
										{used === null ? null : <Bar percent={used} />}
									</View>
								);
							})}
						</View>
						{percent === null ? null : (
							<Text variant="caption" tone="secondary">
								{percent}% do limite em uso
							</Text>
						)}
					</View>
				);
			}}
		</LoadableCard>
	);
}

// ----------------------------------------------------------- fluxo de caixa

export function CashFlowWide({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<CashFlowView>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<LoadableCard title="Fluxo de caixa" state={state} skeletonLines={2} chevron onPress={onPress}>
			{(data) => {
				const peak = Math.max(data.inCents, data.outCents, 1);
				return (
					<View style={{ flexDirection: "row", gap: spacing.xl }}>
						<View style={{ flex: 1 }}>
							<FlowRow
								label="Entrou"
								cents={data.inCents}
								peak={peak}
								color={colors.positive}
								tone="positive"
								hidden={hidden}
							/>
						</View>
						<View style={{ flex: 1 }}>
							<FlowRow
								label="Saiu"
								cents={data.outCents}
								peak={peak}
								color={chart.other}
								tone="primary"
								hidden={hidden}
							/>
						</View>
					</View>
				);
			}}
		</LoadableCard>
	);
}

// ------------------------------------------------------------- parcelamentos

export function InstallmentsWide({
	state,
	month,
	hidden,
	onPress,
}: {
	state: Loadable<InstallmentsView>;
	month: string;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<LoadableCard title="Parcelamentos" state={state} skeletonLines={2} chevron onPress={onPress}>
			{(data) => {
				const { activeCount, monthlyCents } = installmentsOverview(data.groups, month);
				return (
					<Figure
						value={activeCount === 0 ? "Nenhum" : `${activeCount} ${activeCount === 1 ? "ativo" : "ativos"}`}
						caption={
							activeCount > 0
								? `${money(monthlyCents, hidden, { sign: "never" })} por mês`
								: "Nada parcelado agora"
						}
					/>
				);
			}}
		</LoadableCard>
	);
}

// ---------------------------------------------------------------- categorias

/** O quadrado da rosca: o gasto do mês no centro e quantas categorias; sem a lista. */
export function CategoriesSquare({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<[MonthSummary, CategoriesView]>;
	hidden: boolean;
	onPress: () => void;
}) {
	return (
		<Tile title="Gastos por categoria" label="Gastos por categoria, abrir" state={state} onPress={onPress}>
			{([summary, { categories }]) => {
				const shares = categoryShares(summary.summary.byCategory, categories);
				const total = shares.reduce((sum, s) => sum + s.cents, 0);
				if (shares.length === 0) return <Figure value="—" caption="Nenhum gasto ainda" />;
				const top = shares[0];
				return (
					<View style={{ gap: spacing.md }}>
						<DonutChart
							size={72}
							stroke={10}
							segments={shares.map((s) => ({ key: s.key, color: s.color, weight: s.cents }))}
							label={`Gastos esse mês: ${money(total, hidden, { sign: "never" })}, em ${shares.length === 1 ? "1 categoria" : `${shares.length} categorias`}`}
						/>
						<Figure
							value={money(total, hidden, { sign: "never" })}
							caption={top ? `${top.name} ${percentOf(top.cents, total)}%` : ""}
						/>
					</View>
				);
			}}
		</Tile>
	);
}
