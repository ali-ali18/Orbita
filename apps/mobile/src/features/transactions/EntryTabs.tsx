import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { Icon, type IconName, Text } from "../../ui/index.ts";
import type { EntryKind } from "./new-transaction-model.ts";

const TABS: { kind: EntryKind | "transfer"; label: string; icon: IconName }[] = [
	{ kind: "expense", label: "Saída", icon: "menos-circulo" },
	{ kind: "income", label: "Entrada", icon: "mais" },
	{ kind: "transfer", label: "Transferir", icon: "transferir" },
];

/**
 * Abas Saída · Entrada · Transferir (Figma "abas"). Transferir aparece, como no desenho, mas fica
 * desativada: o app ainda não tem a tela de origem e destino.
 */
export function EntryTabs({ value, onChange }: { value: EntryKind; onChange: (kind: EntryKind) => void }) {
	const { accent, onAccent } = useAccent();
	return (
		<View
			accessibilityRole="tablist"
			style={{
				flexDirection: "row",
				gap: spacing.xs,
				padding: spacing.xs,
				borderRadius: radius.pill,
				backgroundColor: colors.surface,
			}}
		>
			{TABS.map((tab) => {
				const active = tab.kind === value;
				const disabled = tab.kind === "transfer";
				return (
					<Pressable
						key={tab.kind}
						accessibilityRole="tab"
						accessibilityLabel={tab.label}
						accessibilityState={{ selected: active, disabled }}
						disabled={disabled}
						onPress={() => {
							if (tab.kind !== "transfer") onChange(tab.kind);
						}}
						style={{
							flex: 1,
							minHeight: 44,
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "center",
							gap: spacing.sm,
							borderRadius: radius.pill,
							backgroundColor: active ? accent : "transparent",
						}}
					>
						<Icon name={tab.icon} size={16} color={active ? onAccent : colors.textSecondary} />
						<Text variant="bodyStrong" tone={active ? "onAccent" : "secondary"}>
							{tab.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
