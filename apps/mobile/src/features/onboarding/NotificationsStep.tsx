import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { BankLogo, Button, Icon, Screen, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { ProgressHeader, SkipLink } from "./parts.tsx";

const NOTES = [
	"Só leio as notificações dos apps de banco que você escolher",
	"O texto vai direto para o seu servidor",
	"Dá para desligar quando quiser nas Configurações",
];

/** Notificações (Figma 53:1084). */
export function NotificationsStep({
	onBack,
	onAllow,
	onSkip,
}: {
	onBack: () => void;
	onAllow: () => void;
	onSkip: () => void;
}) {
	return (
		<Screen>
			<View style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.lg }}>
				<ProgressHeader step={3} onBack={onBack} />
				<View style={{ gap: spacing.xs, paddingTop: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						Deixe eu ler as notificações dos bancos
					</Text>
					<Text variant="body" tone="secondary">
						Assim cada compra entra na hora, sem você digitar nada.
					</Text>
				</View>
				<View
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.block,
						padding: spacing.lg,
						gap: spacing.md,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
						<BankLogo {...bankBadge({ name: "Nubank" })} size={28} />
						<View style={{ flex: 1 }}>
							<Text variant="micro" tone="secondary">
								Nubank · agora
							</Text>
							<Text variant="caption">Compra de R$ 46,90 aprovada em IFOOD</Text>
						</View>
					</View>
					<View style={{ alignItems: "center" }}>
						<Icon name="seta-baixo" size={20} color={colors.textSecondary} />
					</View>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 10,
							backgroundColor: colors.surface2,
							borderRadius: radius.inner,
							paddingHorizontal: spacing.md,
							paddingVertical: 10,
						}}
					>
						<View
							style={{
								width: 28,
								height: 28,
								borderRadius: radius.pill,
								backgroundColor: colors.surface3,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<Icon name="comida" size={14} />
						</View>
						<Text variant="caption" style={{ flex: 1 }}>
							iFood · Delivery
						</Text>
						<Text variant="bodyStrong">−R$ 46,90</Text>
					</View>
				</View>
				<View style={{ gap: spacing.md }}>
					{NOTES.map((note) => (
						<View key={note} style={{ flexDirection: "row", gap: 10 }}>
							<Icon name="check" size={18} />
							<Text variant="body" style={{ flex: 1 }}>
								{note}
							</Text>
						</View>
					))}
				</View>
				<View style={{ flex: 1 }} />
				<Button label="Permitir acesso" onPress={onAllow} />
				<SkipLink label="Agora não" onPress={onSkip} />
			</View>
		</Screen>
	);
}
