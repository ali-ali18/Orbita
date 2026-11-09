import { chart, colors, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { money, monthName } from "../../lib/format.ts";
import { Text } from "../../ui/index.ts";
import { monthAbbrev } from "./card-model.ts";
import { defaultHistoryMonth, type HistoryBar } from "./invoices-model.ts";

const BAR_MAX = 120;
const BAR_MIN = 6;

/**
 * Faturas dos últimos 6 meses, uma barra por mês. O mês ainda aberto (o atual) fica em destaque; os fechados, em
 * cinza. Tocar numa barra mostra o valor do mês acima do gráfico. Os valores vêm prontos do servidor.
 */
export function InvoiceHistoryChart({ bars, hidden }: { bars: readonly HistoryBar[]; hidden: boolean }) {
	const [picked, setPicked] = useState<string | null>(null);
	const month = picked && bars.some((b) => b.month === picked) ? picked : defaultHistoryMonth(bars);
	const selected = bars.find((b) => b.month === month);
	const max = Math.max(1, ...bars.map((b) => b.cents));
	if (bars.length === 0) return null;
	return (
		<View style={{ gap: spacing.md }}>
			{selected ? (
				<View style={{ gap: 2 }}>
					<Text variant="caption" tone="secondary">
						Fatura de {monthName(selected.month).toLocaleLowerCase("pt-BR")}
						{selected.open ? " · aberta, pode crescer" : ""}
					</Text>
					<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1}>
						{money(selected.cents, hidden, { sign: "never" })}
					</Text>
				</View>
			) : null}
			<View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, height: BAR_MAX + 28 }}>
				{bars.map((b) => {
					const active = b.month === month;
					const height = b.cents <= 0 ? BAR_MIN : Math.max(BAR_MIN, Math.round((b.cents / max) * BAR_MAX));
					return (
						<Pressable
							key={b.month}
							accessibilityRole="button"
							accessibilityLabel={`${monthName(b.month)}: ${money(b.cents, hidden, { sign: "never" })}${b.open ? ", aberta" : ""}`}
							accessibilityState={{ selected: active }}
							onPress={() => setPicked(b.month)}
							style={{
								flex: 1,
								alignItems: "center",
								justifyContent: "flex-end",
								gap: spacing.sm,
								height: "100%",
							}}
						>
							<View
								style={{
									width: "100%",
									height,
									borderRadius: radius.sm,
									backgroundColor: b.open ? colors.accent : chart.other,
									opacity: active ? 1 : 0.55,
								}}
							/>
							<Text variant="micro" tone={b.open || active ? "primary" : "secondary"}>
								{monthAbbrev(b.month)}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</View>
	);
}
