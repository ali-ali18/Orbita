import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { Icon, IconButton, type IconName, Screen, Text, TOP_FADE } from "../../ui/index.ts";

/** Um dos dois cartões do Figma (43:811). Sem `onPress` fica esmaecido, com "Em breve". */
function ActionCard({
	icon,
	title,
	caption,
	onPress,
}: {
	icon: IconName;
	title: string;
	caption: string;
	onPress?: () => void;
}) {
	const enabled = onPress !== undefined;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={[title, caption, enabled ? undefined : "em breve"].filter(Boolean).join(", ")}
			accessibilityState={{ disabled: !enabled }}
			disabled={!enabled}
			onPress={onPress}
			style={({ pressed }) => ({
				flex: 1,
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.sm,
				opacity: !enabled ? 0.45 : pressed ? 0.8 : 1,
			})}
		>
			<View
				style={{
					width: layout.touchTarget,
					height: layout.touchTarget,
					borderRadius: radius.pill,
					backgroundColor: colors.surface2,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon name={icon} size={20} />
			</View>
			<Text variant="bodyStrong">{title}</Text>
			<Text variant="caption" tone="secondary">
				{enabled ? caption : "Em breve"}
			</Text>
		</Pressable>
	);
}

/**
 * Tela "Comprovantes e arquivos" (Figma 43:802). "Importar extrato" abre a importação de CSV, OFX ou PDF;
 * "Ler comprovante" segue como "Em breve". A lista "Importados recentemente" do Figma não aparece: o servidor
 * guarda só o hash do arquivo, não o nome nem o histórico.
 */
export function FilesScreen() {
	const router = useRouter();
	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.lg,
				}}
			>
				<View style={{ height: layout.touchTarget, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
					/>
				</View>
				<View style={{ gap: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						Comprovantes e arquivos
					</Text>
					<Text variant="body" tone="secondary">
						Para o que não chega pelo banco: comprovantes de Pix, faturas em PDF e extratos.
					</Text>
				</View>
				<View style={{ flexDirection: "row", gap: spacing.md }}>
					<ActionCard icon="escanear" title="Ler comprovante" caption="Foto ou print de Pix e boleto" />
					<ActionCard
						icon="baixar"
						title="Importar extrato"
						caption="CSV, OFX ou PDF da fatura"
						onPress={() => router.push("/configuracoes/importar")}
					/>
				</View>
			</ScrollView>
		</Screen>
	);
}
