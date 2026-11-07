import type { SecretName, SecretStatusDto } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { useSession } from "../../lib/session.tsx";
import { Button, ConfirmDialog, ErrorState, IconButton, Screen, Skeleton, Text } from "../../ui/index.ts";
import { useSecrets, useServerInfo } from "./queries.ts";
import { SecretSheet } from "./SecretSheet.tsx";
import { SettingsRow, SettingsSection } from "./SettingsRows.tsx";
import { SignOutDialog } from "./SignOutDialog.tsx";
import { useSecretActions } from "./secret-actions.ts";
import {
	formatPairedSince,
	REMOVE_MESSAGE,
	REMOVE_TITLE,
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
				borderRadius: radius.card,
				padding: 18,
				gap: 6,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<View
					style={{
						width: 8,
						height: 8,
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
				<Skeleton width={180} height={14} />
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
					<Skeleton height={20} />
					<Skeleton height={20} />
					<Skeleton height={20} />
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
	const [removing, setRemoving] = useState<SecretName | null>(null);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);

	const status = (name: SecretName | null) => secretsQ.data?.secrets.find((s) => s.name === name);
	const device = serverQ.data?.device;

	const confirmRemove = async () => {
		const name = removing;
		setRemoving(null);
		if (!name) return;
		try {
			await actions.remove(name);
			setRemoveError(null);
		} catch (error) {
			setRemoveError(errorMessage(error));
		}
	};

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 48, gap: spacing.md }}
			>
				<View style={{ height: 44, justifyContent: "center", alignItems: "flex-start" }}>
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
				{removeError ? (
					<View accessibilityRole="alert" accessibilityLiveRegion="polite">
						<Text variant="caption" tone="secondary">
							{removeError}
						</Text>
					</View>
				) : null}

				<SettingsSection title="Este aparelho">
					<SettingsRow info title="Aparelho" value={device?.name ?? "—"} />
					<SettingsRow
						info
						last
						title="Conectado desde"
						value={device ? formatPairedSince(device.pairedAt, year) : "—"}
					/>
				</SettingsSection>

				<View style={{ flexDirection: "row", gap: 10, paddingTop: spacing.xs }}>
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
				onSave={actions.save}
				onAskRemove={(name) => {
					setEditing(null);
					setRemoveError(null);
					setRemoving(name);
				}}
				onClose={() => setEditing(null)}
			/>
			<ConfirmDialog
				visible={removing !== null}
				title={REMOVE_TITLE}
				message={REMOVE_MESSAGE}
				confirmLabel="Remover"
				onCancel={() => setRemoving(null)}
				onConfirm={() => void confirmRemove()}
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
