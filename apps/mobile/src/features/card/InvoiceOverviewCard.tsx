import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import type { InvoicesOverviewView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import { BankLogo, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { cardLabel, cardSpokenName, usagePercent } from "./card-model.ts";
import { invoiceSourceLabel, invoiceStateLabel, invoiceStateTone } from "./invoices-model.ts";

type Line = InvoicesOverviewView["cards"][number];

/**
 * Uma fatura na visão geral: cartão, situação honesta (Paga · Fechada, vence dd/mm · Vencida · Aberta), total,
 * quanto falta pagar e "Limite: usado/total" com barra. Tocar abre o detalhe do cartão.
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
	const { due, open, limit } = line;
	const fmt = (cents: number) => money(cents, hidden, { sign: "never" });
	const share = usagePercent(limit.usedCents, limit.limitCents);
	const showOpen = open.month !== due.month;
	const left = due.state === "closed" || due.state === "overdue" ? due.owedCents : 0;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${cardSpokenName(line.card)}. Fatura ${invoiceStateLabel(due)}, ${fmt(due.totalCents)}. Ver detalhe`}
			onPress={onPress}
			style={({ pressed }) => ({
				gap: spacing.md,
				padding: 18,
				borderRadius: radius.block,
				backgroundColor: colors.surface,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<BankLogo {...bankBadge(line.card)} size={40} />
				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="bodyStrong" numberOfLines={1}>
						{line.card.name}
					</Text>
					<Text variant="caption" tone="secondary">
						{line.card.last4 ? cardLabel(line.card) : "Cartão de crédito"}
					</Text>
				</View>
				<Text variant="bodyStrong">{fmt(due.totalCents)}</Text>
			</View>
			<Text variant="bodyStrong" tone={invoiceStateTone(due.state)}>
				{invoiceStateLabel(due)}
			</Text>
			{left > 0 ? (
				<Text variant="caption" tone="secondary">
					Falta pagar {fmt(left)}
					{due.paidCents > 0 ? ` · já pago ${fmt(due.paidCents)}` : ""}
				</Text>
			) : null}
			{showOpen ? (
				<Text variant="caption" tone="secondary">
					Fatura aberta {fmt(open.totalCents)} · fecha {open.closingDate.slice(8, 10)}/
					{open.closingDate.slice(5, 7)}
				</Text>
			) : null}
			<Text variant="micro" tone="tertiary">
				{invoiceSourceLabel(due.source)}
			</Text>
			<View style={{ height: 1, backgroundColor: colors.border }} />
			{limit.limitCents !== null ? (
				<View style={{ gap: spacing.sm }}>
					<View style={{ flexDirection: "row" }}>
						<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
							Limite: {fmt(limit.usedCents)} / {fmt(limit.limitCents)}
						</Text>
						{limit.source === "estimated" ? (
							<Text variant="caption" tone="secondary">
								estimado
							</Text>
						) : null}
					</View>
					<View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" }}>
						<View
							style={{
								width: `${Math.min(100, share ?? 0)}%`,
								height: 6,
								borderRadius: 3,
								backgroundColor: colors.accent,
							}}
						/>
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
