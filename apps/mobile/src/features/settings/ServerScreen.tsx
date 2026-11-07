import type { SecretName, SecretStatusDto } from "@orbita/shared";
import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { useSession } from "../../lib/session.tsx";
import { Button, ErrorState, IconButton, Screen, Skeleton, Text } from "../../ui/index.ts";
import { useSecrets, useServerInfo } from "./queries.ts";
import { SecretSheet } from "./SecretSheet.tsx";
import { SettingsRow, SettingsSection } from "./SettingsRows.tsx";
import { SignOutDialog } from "./SignOutDialog.tsx";
import { useSecretActions } from "./secret-actions.ts";
import {
	formatPairedSince,
	SECRET_ROW_LABELS,
	SWITCH_SERVER_MESSAGE,
	SWITCH_SERVER_TITLE,
	secretCaption,
	secretStateLabel,
	serverStatusLine,
	yearOf,
} from "./settings-model.ts";

function StatusCard() {
	const { baseUrl } = useSession();
	const q = useServerInfo();
	const failed = q.isError;
	const title = failed ? "Sem resposta" : q.data ? "Conectado" : "Conectando…";
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.block,
				padding: spacing.xl,
				gap: spacing.sm,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<View
					style={{
						width: spacing.sm,
						height: spacing.sm,
						borderRadius: radius.pill,
						backgroundColor: failed || !q.data ? colors.textTertiary : colors.accent,
					}}
				/>
				<Text variant="bodyStrong" accessibilityLiveRegion="polite">
					{title}
				</Text>
			</View>
			<Text variant="caption" tone="secondary" selectable>
				{baseUrl}
			</Text>
			{failed ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
					{errorMessage(q.error)}
				</Text>
			) : q.data ? (
				<Text variant="caption" tone="secondary">
					{serverStatusLine(q.data.version, q.data.ms)}
				</Text>
			) : (
				<Skeleton width="60%" height={spacing.lg} />
			)}
		</View>
	);
}

function KeysSection({ onOpen }: { onOpen: (status: SecretStatusDto) => void }) {
	const year = yearOf(useClock().today);
	const secrets = toLoadable(useSecrets());
	if (secrets.phase === "loading") {
		return (
			<SettingsSection title="Chaves">
				<View style={{ padding: spacing.lg, gap: spacing.md }}>
					<Skeleton height={spacing.xl} />
					<Skeleton height={spacing.xl} />
					<Skeleton height={spacing.xl} />
				</View>
			</SettingsSection>
		);
	}
	if (secrets.phase === "error") {
		return (
			<SettingsSection title="Chaves">
				<View style={{ padding: spacing.lg }}>
					<ErrorState message={secrets.message} onRetry={secrets.retry} />
				</View>
			</SettingsSection>
		);
	}
	const list = secrets.data.secrets;
	return (
		<SettingsSection title="Chaves">
			{list.map((s, i) => (
				<SettingsRow
					key={s.name}
					icon="chave"
					title={SECRET_ROW_LABELS[s.name]}
					caption={secretCaption(s, year)}
					value={secretStateLabel(s)}
					onPress={() => onOpen(s)}
					last={i === list.length - 1}
				/>
			))}
		</SettingsSection>
	);
}

/** Tela "Servidor e chaves" (Figma 44:817). O valor de uma chave nunca aparece: só o estado. */
export function ServerScreen() {
	const router = useRouter();
	const year = yearOf(useClock().today);
	const serverQ = useServerInfo();
	const secretsQ = useSecrets();
	const actions = useSecretActions();
	const [editing, setEditing] = useState<SecretName | null>(null);
	const [switching, setSwitching] = useState(false);

	const status = (name: SecretName | null) => secretsQ.data?.secrets.find((s) => s.name === name);
	const device = serverQ.data?.device;

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.md,
				}}
			>
				<View style={{ height: layout.touchTarget, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/configuracoes"))}
					/>
				</View>
				<View style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						Servidor e chaves
					</Text>
					<Text variant="body" tone="secondary">
						O app só conversa com o seu servidor. As chaves ficam lá, nunca no celular.
					</Text>
				</View>

				<StatusCard />

				<KeysSection onOpen={(s) => setEditing(s.name)} />

				<SettingsSection title="Este aparelho">
					<SettingsRow info title="Aparelho" value={device?.name ?? "—"} />
					<SettingsRow
						info
						last
						title="Conectado desde"
						value={device ? formatPairedSince(device.pairedAt, year) : "—"}
					/>
				</SettingsSection>

				<View style={{ flexDirection: "row", gap: spacing.md, paddingTop: spacing.xs }}>
					<Button
						label="Testar conexão"
						variant="secondary"
						loading={serverQ.isFetching}
						onPress={() => void serverQ.refetch()}
						style={{ flex: 1 }}
					/>
					<Button
						label="Trocar servidor"
						variant="secondary"
						onPress={() => setSwitching(true)}
						style={{ flex: 1 }}
					/>
				</View>
			</ScrollView>

			<SecretSheet
				name={editing}
				configured={status(editing)?.configured ?? false}
				actions={actions}
				onClose={() => setEditing(null)}
			/>
			<SignOutDialog
				visible={switching}
				onCancel={() => setSwitching(false)}
				title={SWITCH_SERVER_TITLE}
				message={SWITCH_SERVER_MESSAGE}
				confirmLabel="Trocar servidor"
			/>
		</Screen>
	);
}
