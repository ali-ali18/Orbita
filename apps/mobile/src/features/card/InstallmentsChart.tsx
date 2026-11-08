import { colors, radius, spacing } from "@orbita/tokens";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";
import { money, monthName } from "../../lib/format.ts";
import { Text } from "../../ui/index.ts";
import { type CardLike, cardColor, type MonthColumn, monthAbbrev } from "./card-model.ts";
import { Dot } from "./parts.tsx";

const BAR_MAX = 150;
const BAR_MIN = 24;
const BAR_WIDTH = 36;
/** Quantas colunas cabem na largura, como no Figma (mês atual + sete seguintes). */
const VISIBLE = 8;
const TIP_WIDTH = 156;

/**
 * Parcelas por mês, empilhadas por cartão (a mesma cor do logo). A fileira ocupa a largura toda: o mês
 * atual na frente, cheio, e os seguintes em 40%. Meses anteriores ficam à esquerda, no mesmo eixo.
 * Tocar numa coluna abre o valor ao lado dela, sem encolher o gráfico.
 */
export function InstallmentsChart({
	columns,
	cards,
	hidden,
	currentMonth,
}: {
	columns: readonly MonthColumn[];
	cards: readonly CardLike[];
	hidden: boolean;
	currentMonth: string;
}) {
	const [openMonth, setOpenMonth] = useState<string | null>(null);
	const [track, setTrack] = useState(0);
	const [scrollX, setScrollX] = useState(0);
	const scrollRef = useRef<ScrollViewInstance>(null);
	const max = Math.max(1, ...columns.map((c) => c.totalCents));
	const used = cards.filter((c) => columns.some((col) => col.byCard.some((p) => p.cardId === c.id)));
	const open = columns.find((col) => col.month === openMonth && col.totalCents > 0) ?? null;
	const futureCount = columns.filter((col) => col.month >= currentMonth).length;
	const pastCount = columns.length - futureCount;
	const visible = Math.min(VISIBLE, Math.max(futureCount, 1));
	const scrollable = pastCount > 0 || futureCount > VISIBLE;
	const slot = track > 0 ? track / (scrollable ? visible : Math.max(columns.length, 1)) : 0;
	const startX = scrollable ? pastCount * slot : 0;

	useEffect(() => {
		if (!scrollable || slot === 0) return;
		scrollRef.current?.scrollTo({ x: startX, y: 0, animated: false });
		setScrollX(startX);
	}, [scrollable, slot, startX]);

	const bars = columns.map((col) => {
		const height = col.totalCents === 0 ? 0 : Math.max(BAR_MIN, Math.round((col.totalCents / max) * BAR_MAX));
		const current = col.month === currentMonth;
		const expanded = open?.month === col.month;
		const label = `${monthAbbrev(col.month)}: ${money(col.totalCents, hidden, { sign: "never" })}`;
		return (
			<Pressable
				key={col.month}
				accessibilityRole="button"
				accessibilityLabel={expanded ? `${label}. Valor aberto` : label}
				accessibilityState={{ expanded }}
				disabled={col.totalCents === 0}
				onPress={() => setOpenMonth(expanded ? null : col.month)}
				style={
					scrollable
						? { width: slot, alignItems: "center", gap: 10 }
						: { flex: 1, alignItems: "center", gap: 10 }
				}
			>
				<View
					style={{
						width: BAR_WIDTH,
						height,
						gap: 2,
						borderRadius: radius.pill,
						overflow: "hidden",
						opacity: current ? 1 : 0.4,
					}}
				>
					{col.byCard.map((p) => {
						const card = cards.find((c) => c.id === p.cardId);
						return (
							<View
								key={p.cardId}
								style={{ flex: p.cents, backgroundColor: card ? cardColor(card) : colors.surface3 }}
							/>
						);
					})}
				</View>
				<Text variant="micro" tone={expanded || current ? "primary" : "secondary"}>
					{monthAbbrev(col.month)}
				</Text>
			</Pressable>
		);
	});

	const openIndex = open ? columns.findIndex((col) => col.month === open.month) : -1;
	const beside =
		openIndex < 0 || slot === 0 ? 0 : openIndex * slot - scrollX + slot / 2 + BAR_WIDTH / 2 + spacing.sm;
	const tipLeft =
		beside + TIP_WIDTH > track ? Math.max(0, beside - BAR_WIDTH - spacing.sm * 2 - TIP_WIDTH) : beside;

	return (
		<View style={{ gap: spacing.md }}>
			<View style={{ position: "relative" }} onLayout={(e) => setTrack(e.nativeEvent.layout.width)}>
				{scrollable ? (
					<ScrollView
						ref={scrollRef}
						horizontal
						showsHorizontalScrollIndicator={false}
						scrollEventThrottle={16}
						onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
					>
						<View style={{ flexDirection: "row", alignItems: "flex-end", paddingTop: spacing.lg }}>
							{bars}
						</View>
					</ScrollView>
				) : (
					<View
						style={{
							flexDirection: "row",
							alignItems: "flex-end",
							gap: spacing.sm,
							paddingTop: spacing.lg,
						}}
					>
						{bars}
					</View>
				)}
				{open ? (
					<View
						style={{
							position: "absolute",
							top: spacing.lg,
							left: tipLeft,
							width: TIP_WIDTH,
							backgroundColor: colors.surface,
							borderRadius: radius.inner,
							paddingHorizontal: spacing.md,
							paddingVertical: spacing.sm,
							gap: spacing.sm,
						}}
					>
						<Text variant="caption" tone="secondary">
							{monthName(open.month)}
						</Text>
						{open.byCard.map((part) => {
							const card = cards.find((c) => c.id === part.cardId);
							return (
								<View key={part.cardId} style={{ gap: 2 }}>
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
										<Dot color={card ? cardColor(card) : colors.surface3} />
										<Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
											{card?.name ?? "Cartão"}
										</Text>
									</View>
									<Text variant="bodyStrong">{money(part.cents, hidden, { sign: "never" })}</Text>
								</View>
							);
						})}
					</View>
				) : null}
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.xs }}>
				{used.map((c) => (
					<View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
						<Dot color={cardColor(c)} />
						<Text variant="caption" tone="secondary">
							{c.name}
						</Text>
					</View>
				))}
			</View>
		</View>
	);
}
