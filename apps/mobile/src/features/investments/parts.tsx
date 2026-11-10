import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { BankLogo, Card, Text } from "../../ui/index.ts";
import type { PositionRow, YieldCard } from "./investments-model.ts";

/** Cartão de meia largura: rótulo, valor (ou traço), legenda e, quando vale, o selo "estimado"/"parcial". */
export function YieldTile({ label, y }: { label: string; y: YieldCard }) {
	return (
		<Card style={{ flex: 1, padding: spacing.lg }}>
			<View accessible accessibilityLabel={y.a11y} style={{ gap: spacing.xs }}>
				<Text variant="caption" tone="secondary" numberOfLines={1}>
					{label}
				</Text>
				<Text variant="numberMedium" tone={y.tone} numberOfLines={1} adjustsFontSizeToFit>
					{y.value ?? "—"}
				</Text>
				<Text variant="caption" tone="secondary" numberOfLines={2}>
					{y.caption}
				</Text>
				{y.note ? (
					<View
						style={{
							alignSelf: "flex-start",
							paddingHorizontal: spacing.sm,
							borderRadius: radius.pill,
							backgroundColor: colors.surface2,
						}}
					>
						<Text variant="micro" tone="secondary">
							{y.note}
						</Text>
					</View>
				) : null}
			</View>
		</Card>
	);
}

/** Abas em pílula (Classes · Instituições, 1 mês · 6 meses · 1 ano): a ativa na cor primária do tema. */
export function PillTabs<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (next: T) => void;
}) {
	const { accent } = useAccent();
	return (
		<View accessibilityRole="tablist" style={{ flexDirection: "row", gap: spacing.sm }}>
			{options.map((o) => {
				const active = o.id === value;
				return (
					<Pressable
						key={o.id}
						accessibilityRole="tab"
						accessibilityLabel={o.label}
						accessibilityState={{ selected: active }}
						onPress={() => onChange(o.id)}
						style={{
							minHeight: 44,
							paddingHorizontal: spacing.lg,
							justifyContent: "center",
							borderRadius: radius.pill,
							backgroundColor: active ? accent : colors.surface,
						}}
					>
						<Text variant="bodyStrong" tone={active ? "onAccent" : "secondary"} numberOfLines={1}>
							{o.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/** Linha de uma posição: marca do banco, nome, tipo e taxa, saldo e rendimento. */
export function PositionLine({ row, onPress }: { row: PositionRow; onPress: () => void }) {
	const y = row.yieldCard;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${row.title}, ${row.subtitle}, ${row.value}. ${y.a11y}`}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				minHeight: 64,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<BankLogo {...row.badge} size={44} />
			<View style={{ flex: 1 }}>
				<Text variant="bodyStrong" numberOfLines={1}>
					{row.title}
				</Text>
				<Text variant="caption" tone="secondary" numberOfLines={1}>
					{row.subtitle}
				</Text>
			</View>
			<View style={{ alignItems: "flex-end", maxWidth: "42%" }}>
				<Text variant="bodyStrong" numberOfLines={1}>
					{row.value}
				</Text>
				<Text variant="caption" tone={y.value ? y.tone : "secondary"} numberOfLines={1}>
					{y.value ? `${y.value}${y.note ? " · est." : ""}` : y.caption}
				</Text>
			</View>
		</Pressable>
	);
}
