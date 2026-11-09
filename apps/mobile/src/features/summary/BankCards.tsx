import { chart, colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { AccountBalancesView, CashFlowView, InvoicesOverviewView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { BankLogo, ErrorState, Ring, Text } from "../../ui/index.ts";
import { usagePercent } from "../card/card-model.ts";
import { accountsCountLabel } from "./bank-cards-model.ts";
import { Frame, Placeholder } from "./SquareCards.tsx";
import { bankBadge } from "./summary-model.ts";

/*
 * Os cards-resumo do Início que vêm do banco: Saldo em contas, Limite e Fluxo de caixa. Cada um é um quadrado tocável
 * que abre o detalhe, com um número principal e no máximo uma linha de apoio. Só exibem o que a API devolveu.
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

/** Valor grande do quadrado, com uma linha de apoio. */
function Figure({ value, caption }: { value: string; caption: string }) {
	return (
		<View style={{ gap: 2 }}>
			<Text variant="numberMedium" adjustsFontSizeToFit numberOfLines={1}>
				{value}
			</Text>
			<Text variant="caption" tone="secondary" numberOfLines={1}>
				{caption}
			</Text>
		</View>
	);
}

const MAX_LOGOS = 4;

export function BalanceTile({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<AccountBalancesView>;
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
						/>
					</View>
				);
			}}
		</Tile>
	);
}

export function LimitTile({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<InvoicesOverviewView>;
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
				return (
					<View style={{ gap: spacing.md }}>
						<Ring percent={percent} size={64} stroke={8} label={`${percent}% do limite usado`}>
							<Text variant="bodyStrong">{`${percent}%`}</Text>
						</Ring>
						<Figure value={money(limits.availableCents, hidden, { sign: "never" })} caption="disponível" />
					</View>
				);
			}}
		</Tile>
	);
}

export function CashFlowTile({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<CashFlowView>;
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
					</View>
				);
			}}
		</Tile>
	);
}
