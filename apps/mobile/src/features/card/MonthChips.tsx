import { colors, radius, spacing } from "@orbita/tokens";
import { useEffect, useRef } from "react";
import { Pressable, type ScrollViewInstance, View } from "react-native";
import { monthName } from "../../lib/format.ts";
import { Text } from "../../ui/index.ts";
import { BleedRow } from "./parts.tsx";

export interface MonthOption {
	month: string;
	/** "aberta", "fechada", "venceu". */
	status: string;
}

/** Fila de meses da fatura ("Outubro venceu", "Novembro fechada"). Rola até o escolhido. */
export function MonthChips({
	options,
	value,
	onChange,
}: {
	options: readonly MonthOption[];
	value: string;
	onChange: (month: string) => void;
}) {
	const ref = useRef<ScrollViewInstance>(null);
	const xs = useRef(new Map<string, number>());

	useEffect(() => {
		const x = xs.current.get(value);
		if (x !== undefined) ref.current?.scrollTo({ x: Math.max(0, x - spacing.lg), animated: false });
	}, [value]);

	return (
		<BleedRow scrollRef={ref}>
			{options.map((o) => {
				const active = o.month === value;
				return (
					<Pressable
						key={o.month}
						accessibilityRole="button"
						accessibilityLabel={`${monthName(o.month)}, ${o.status}`}
						accessibilityState={{ selected: active }}
						onPress={() => onChange(o.month)}
						onLayout={(e) => {
							xs.current.set(o.month, e.nativeEvent.layout.x);
							if (active)
								ref.current?.scrollTo({
									x: Math.max(0, e.nativeEvent.layout.x - spacing.lg),
									animated: false,
								});
						}}
						style={{ minHeight: 44, justifyContent: "center" }}
					>
						<View
							style={{
								flexDirection: "row",
								alignItems: "baseline",
								gap: 6,
								paddingHorizontal: 14,
								paddingVertical: spacing.sm,
								borderRadius: radius.pill,
								backgroundColor: active ? colors.accent : colors.surface,
								borderWidth: active ? 0 : 1,
								borderColor: colors.border,
							}}
						>
							<Text variant="bodyStrong" tone={active ? "onAccent" : "primary"}>
								{monthName(o.month)}
							</Text>
							<Text variant="caption" tone={active ? "onAccent" : "secondary"}>
								{o.status}
							</Text>
						</View>
					</Pressable>
				);
			})}
		</BleedRow>
	);
}
