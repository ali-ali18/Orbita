import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { IconButton, Text } from "../../ui/index.ts";
import { type OnboardingStep, progressLabel } from "./model.ts";

/** Voltar, quatro traços e "N de 4", como no topo das telas de primeira vez. */
export function ProgressHeader({ step, onBack }: { step: OnboardingStep; onBack: () => void }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, height: 40 }}>
			<IconButton icon="voltar" label="Voltar" size={40} iconSize={18} onPress={onBack} />
			<View style={{ flex: 1, flexDirection: "row", gap: spacing.xs }}>
				{([1, 2, 3, 4] as const).map((n) => (
					<View
						key={n}
						style={{
							flex: 1,
							height: 4,
							borderRadius: radius.pill,
							backgroundColor: n <= step ? colors.text : colors.surface3,
						}}
					/>
				))}
			</View>
			<Text variant="caption" tone="secondary">
				{progressLabel(step)}
			</Text>
		</View>
	);
}

/** "Pular por agora", "Agora não", "Ajustar depois". */
export function SkipLink({ label, onPress }: { label: string; onPress: () => void }) {
	return (
		<Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}>
			<Text variant="body" tone="secondary" style={{ textAlign: "center" }}>
				{label}
			</Text>
		</Pressable>
	);
}
