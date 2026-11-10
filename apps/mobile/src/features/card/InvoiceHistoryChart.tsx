import { chart, colors, radius, spacing } from "@orbita/tokens";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";
import { money, monthName } from "../../lib/format.ts";
import { useAccent } from "../../lib/theme.tsx";
import { Text } from "../../ui/index.ts";
import { monthAbbrev } from "./card-model.ts";
import { barLabel, type HistoryBar } from "./invoices-model.ts";

const BAR_MAX = 120;
const BAR_MIN = 6;
/** Largura de cada barra tocável (acima do mínimo de 44 de toque). */
const SLOT = 48;

/**
 * Faturas por mês: os 6 até a aberta e os seguintes que já têm valor. A barra do mês selecionado fica em destaque, as
 * outras neutras; tocar numa barra escolhe o mês (a tela decide o que mostrar). O título é único: mês e valor do
 * selecionado. Rola na horizontal quando não cabe. Os valores vêm prontos do servidor.
 */
export function InvoiceHistoryChart({
	bars,
	month,
	onSelect,
	hidden,
}: {
	bars: readonly HistoryBar[];
	month: string | null;
	onSelect: (month: string) => void;
	hidden: boolean;
}) {
	const { accent } = useAccent();
	const ref = useRef<ScrollViewInstance>(null);
	const selected = bars.find((b) => b.month === month);
	const index = bars.findIndex((b) => b.month === month);
	useEffect(() => {
		if (index >= 0)
			ref.current?.scrollTo({ x: Math.max(0, (index - 2) * (SLOT + spacing.sm)), animated: false });
	}, [index]);
	if (bars.length === 0) return null;
	const max = Math.max(1, ...bars.map((b) => b.cents));
	return (
		<View style={{ gap: spacing.md }}>
			{selected ? (
				<View style={{ gap: 2 }}>
					<Text variant="cardTitle" tone="secondary">
						Fatura de {monthName(selected.month).toLocaleLowerCase("pt-BR")}
					</Text>
					<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
						{money(selected.cents, hidden, { sign: "never" })}
					</Text>
				</View>
			) : null}
			<ScrollView
				ref={ref}
				horizontal
				showsHorizontalScrollIndicator={false}
				style={{ marginHorizontal: -spacing.lg, flexGrow: 0 }}
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					gap: spacing.sm,
					alignItems: "flex-end",
					height: BAR_MAX + 36,
				}}
			>
				{bars.map((b) => {
					const active = b.month === month;
					const height = b.cents <= 0 ? BAR_MIN : Math.max(BAR_MIN, Math.round((b.cents / max) * BAR_MAX));
					return (
						<Pressable
							key={b.month}
							accessibilityRole="button"
							accessibilityLabel={barLabel(
								monthName(b.month).toLocaleLowerCase("pt-BR"),
								money(b.cents, hidden, { sign: "never" }),
								b.state,
							)}
							accessibilityState={{ selected: active }}
							onPress={() => onSelect(b.month)}
							style={{
								width: SLOT,
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
									backgroundColor: active ? accent : chart.other,
									opacity: active ? 1 : 0.55,
								}}
							/>
							<Text variant="micro" tone={active ? "primary" : "secondary"}>
								{monthAbbrev(b.month)}
							</Text>
						</Pressable>
					);
				})}
			</ScrollView>
		</View>
	);
}
