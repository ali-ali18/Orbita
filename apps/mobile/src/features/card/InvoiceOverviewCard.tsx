import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import type { InvoicesOverviewView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import { BankLogo, CardHighlight, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { bandLook } from "../summary/wallet-model.ts";
import { cardLabel, cardSpokenName, usagePercent } from "./card-model.ts";
import { dueShort, invoiceStateTone, invoiceStateWord } from "./invoices-model.ts";

type Line = InvoicesOverviewView["cards"][number];

/**
 * Uma fatura na visão geral: logo, "Cartão •••• final" e "Vence dd/mm"; o valor grande com a situação em pílula
 * (Aberta · Fechada · Paga · Vencida); embaixo "Limite" com a barra na cor do emissor e "Usado" / "Total". Tocar abre o
 * detalhe do cartão.
 */
export function InvoiceOverviewCard({
	line,
	hidden,
	onPress,
}: {
	line: Line;
	hidden: boolean;
	onPress: () => void;
}) {
	const { due, limit } = line;
	const fmt = (cents: number) => money(cents, hidden, { sign: "never" });
	const share = usagePercent(limit.usedCents, limit.limitCents);
	const state = invoiceStateWord(due.state);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${cardSpokenName(line.card)}. Fatura ${state.toLowerCase()}, vence ${dueShort(due.dueDate)}, ${fmt(due.totalCents)}. Ver detalhe`}
			onPress={onPress}
			style={({ pressed }) => ({
				gap: spacing.md,
				padding: 18,
				borderRadius: radius.block,
				backgroundColor: colors.surface,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<CardHighlight radius={radius.block} />
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<BankLogo {...bankBadge(line.card)} size={44} />
				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="bodyStrong" numberOfLines={1}>
						{line.card.name}
						{line.card.last4 ? ` ${cardLabel(line.card)}` : ""}
					</Text>
					<Text variant="caption" tone="secondary">
						Vence {dueShort(due.dueDate)}
					</Text>
				</View>
			</View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: spacing.md,
				}}
			>
				<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1} style={{ flexShrink: 1 }}>
					{fmt(due.totalCents)}
				</Text>
				<View
					style={{
						paddingHorizontal: spacing.md,
						paddingVertical: spacing.xs + 2,
						borderRadius: radius.pill,
						backgroundColor: colors.surface3,
					}}
				>
					<Text variant="bodyStrong" tone={invoiceStateTone(due.state)}>
						{state}
					</Text>
				</View>
			</View>
			<View style={{ height: 1, backgroundColor: colors.border }} />
			{limit.limitCents !== null ? (
				<View style={{ gap: spacing.sm }}>
					<Text variant="caption" tone="secondary">
						Limite
					</Text>
					<View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" }}>
						<View
							style={{
								width: `${Math.min(100, Math.max(limit.usedCents > 0 ? 3 : 0, share ?? 0))}%`,
								height: 6,
								borderRadius: 3,
								backgroundColor: bandLook(line.card).band,
							}}
						/>
					</View>
					<View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
						<Text variant="caption" tone="secondary">
							Usado: {fmt(limit.usedCents)}
						</Text>
						<Text variant="caption" tone="secondary">
							Total: {fmt(limit.limitCents)}
						</Text>
					</View>
				</View>
			) : (
				<Text variant="caption" tone="secondary">
					Limite não informado
				</Text>
			)}
		</Pressable>
	);
}
