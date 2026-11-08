import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Button, Sheet, SheetGroup, Text } from "../../ui/index.ts";

export interface RepeatLine {
	label: string;
	value: string;
}

/**
 * Gaveta "Repetir": mostra o que a recorrência vai levar do lançamento (nome, valor, dia, conta, categoria) e cria
 * com "Repetir todo mês". É a mesma recorrência das Assinaturas; lá o dono edita o que quiser depois.
 */
export function RepeatSheet({
	visible,
	lines,
	startLabel,
	busy,
	message,
	onConfirm,
	onClose,
}: {
	visible: boolean;
	lines: readonly RepeatLine[];
	/** "dezembro": a partir de quando conta. */
	startLabel: string;
	busy: boolean;
	message: string | null;
	onConfirm: () => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Repetir" onClose={onClose}>
			<View style={{ paddingTop: spacing.md, gap: spacing.md }}>
				<Text variant="body" tone="secondary">
					{`Este lançamento vira uma recorrência, lançada todo mês a partir de ${startLabel}.`}
				</Text>
				<SheetGroup gap={false}>
					{lines.map((line) => (
						<View
							key={line.label}
							accessible
							accessibilityLabel={`${line.label}, ${line.value}`}
							style={{
								minHeight: 52,
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
								gap: spacing.md,
								paddingHorizontal: spacing.lg,
							}}
						>
							<Text variant="body" tone="secondary">
								{line.label}
							</Text>
							<Text variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
								{line.value}
							</Text>
						</View>
					))}
				</SheetGroup>
				{message ? (
					<View accessibilityRole="alert" accessibilityLiveRegion="polite">
						<Text variant="caption" tone="secondary">
							{message}
						</Text>
					</View>
				) : null}
				<Button label="Repetir todo mês" onPress={onConfirm} loading={busy} />
			</View>
		</Sheet>
	);
}
