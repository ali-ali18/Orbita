import { colors, layout, radius, spacing } from "@orbita/tokens";
import { ScrollView, View } from "react-native";
import { BankLogo, Button, Icon, IconButton, OrbitaAvatar, Screen, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { bankColorByName } from "./banks-model.ts";
import { type ConnectExplainerText, connectExplainerText, explainerBankName } from "./connect-model.ts";

const LOGO = 64;

/** O banco e a Órbita lado a lado, com a Órbita sobrepondo o logo (Figma 53:1213). */
function Pair({ bank }: { bank: string | null }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center" }}>
			{bank ? <BankLogo {...bankBadge({ name: bank })} color={bankColorByName(bank)} size={LOGO} /> : null}
			<View
				style={{
					marginLeft: bank ? -spacing.md : 0,
					width: LOGO,
					height: LOGO,
					borderRadius: radius.pill,
					backgroundColor: colors.surface,
					borderWidth: 3,
					borderColor: colors.background,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<OrbitaAvatar size={40} />
			</View>
		</View>
	);
}

function Step({ n, title, caption }: { n: number; title: string; caption: string }) {
	return (
		<View accessible style={{ flexDirection: "row", gap: spacing.lg }}>
			<View
				style={{
					width: 28,
					height: 28,
					borderRadius: radius.pill,
					backgroundColor: colors.surface2,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Text variant="bodyStrong">{n}</Text>
			</View>
			<View style={{ flex: 1 }}>
				<Text variant="bodyStrong">{title}</Text>
				<Text variant="caption" tone="secondary">
					{caption}
				</Text>
			</View>
		</View>
	);
}

/**
 * "Conectar banco" (Figma 53:1207): os três passos antes de abrir o Pluggy Connect.
 * Serve para qualquer banco: sem nome, o texto fala do "seu banco".
 */
export function ConnectExplainer({
	bank,
	loading,
	onOpen,
	onClose,
}: {
	bank: string | null;
	loading?: boolean;
	onOpen: () => void;
	onClose: () => void;
}) {
	const text: ConnectExplainerText = connectExplainerText(bank);
	const name = explainerBankName(bank);
	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{
					paddingTop: layout.statusBar,
					paddingHorizontal: spacing.xl,
					paddingBottom: spacing.lg,
					gap: spacing.xxl,
				}}
			>
				<View style={{ alignItems: "flex-start" }}>
					<IconButton icon="fechar" label={text.close} onPress={onClose} />
				</View>
				<Pair bank={name} />
				<View style={{ gap: spacing.sm }}>
					<Text variant="greeting" accessibilityRole="header">
						{text.title}
					</Text>
					<Text variant="body" tone="secondary">
						{text.subtitle}
					</Text>
				</View>
				<View
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.block,
						padding: spacing.xl,
						gap: spacing.xl,
					}}
				>
					{text.steps.map((step, i) => (
						<Step key={step.title} n={i + 1} title={step.title} caption={step.caption} />
					))}
				</View>
				<View
					style={{
						flexDirection: "row",
						gap: spacing.md,
						backgroundColor: colors.surface,
						borderRadius: radius.block,
						padding: spacing.lg,
					}}
				>
					<Icon name="info" size={18} color={colors.textSecondary} />
					<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
						{text.note}
					</Text>
				</View>
			</ScrollView>
			<View
				style={{ paddingHorizontal: spacing.xl, paddingBottom: layout.homeIndicator, paddingTop: spacing.md }}
			>
				<Button label={text.button} loading={loading ?? false} onPress={onOpen} />
			</View>
		</Screen>
	);
}
