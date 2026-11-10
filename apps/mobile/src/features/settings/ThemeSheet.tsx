import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { useTheme } from "../../lib/theme.tsx";
import { Button, Chip, Sheet, SheetGroup, SheetRow, Text } from "../../ui/index.ts";
import { StaticSwitch } from "./SettingsRows.tsx";
import { themeOptions } from "./theme-options.ts";

/** Bolinha com a cor primária da opção; borda fina para o branco e o preto não sumirem no fundo. */
function Swatch({ color }: { color: string }) {
	return (
		<View
			accessibilityElementsHidden
			style={{
				width: spacing.xl,
				height: spacing.xl,
				borderRadius: radius.pill,
				backgroundColor: color,
				borderWidth: 1,
				borderColor: colors.border,
			}}
		/>
	);
}

/**
 * Gaveta "Tema": a cor primária do app (botão principal, chip ativo, interruptor). Escolher troca na hora e fica
 * guardado neste aparelho. A prévia embaixo usa os mesmos componentes do app, então muda junto.
 */
export function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
	const { key, setTheme } = useTheme();
	return (
		<Sheet visible={visible} title="Tema" onClose={onClose}>
			<View style={{ paddingBottom: spacing.md }}>
				<SheetGroup>
					{themeOptions.map((o) => (
						<SheetRow
							key={o.key}
							leading={<Swatch color={o.accent} />}
							label={o.label}
							role="radio"
							selected={key === o.key}
							onPress={() => setTheme(o.key)}
						/>
					))}
				</SheetGroup>
				<Text variant="caption" tone="secondary" style={{ marginBottom: spacing.sm }}>
					Prévia
				</Text>
				<View
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: spacing.md,
						backgroundColor: colors.surface2,
						borderRadius: radius.group,
						padding: spacing.lg,
					}}
				>
					<View style={{ flex: 1 }}>
						<Button compact label="Botão" onPress={() => {}} />
					</View>
					<Chip label="Ativo" active />
					<StaticSwitch on />
				</View>
			</View>
		</Sheet>
	);
}
