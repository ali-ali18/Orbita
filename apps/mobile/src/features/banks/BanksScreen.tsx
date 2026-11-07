import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { toLoadable } from "../../lib/loadable.ts";
import { BankLogo, Button, ErrorState, IconButton, Screen, Skeleton, Text } from "../../ui/index.ts";
import { SettingsRow, SettingsSection } from "../settings/SettingsRows.tsx";
import {
	bankColorByName,
	canSync,
	connectionName,
	connectionStatusLine,
	EMPTY_MESSAGE,
	EMPTY_TITLE,
	KEYS_MISSING_MESSAGE,
	KEYS_MISSING_TITLE,
	syncButtonLabel,
	syncCardText,
	syncErrorMessage,
} from "./banks-model.ts";
import { AddConnectionSheet, ConnectionSheet } from "./ConnectionSheets.tsx";
import { usePluggyActions, usePluggyStatus } from "./queries.ts";
import { useNow } from "./use-now.ts";

function Panel({ children }: { children: React.ReactNode }) {
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.sm,
			}}
		>
			{children}
		</View>
	);
}

/** Tela "Bancos e cartões" (Figma 43:651): as conexões do Meu Pluggy, a sincronização e o cadastro. */
export function BanksScreen() {
	const router = useRouter();
	const now = useNow();
	const statusQ = usePluggyStatus();
	const { sync, add, remove } = usePluggyActions();
	const [adding, setAdding] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const [syncMessage, setSyncMessage] = useState<string | null>(null);
	const syncLocked = useRef(false);

	const status = toLoadable(statusQ);
	const data = status.phase === "ready" ? status.data : null;
	const card = data ? syncCardText(data, now) : null;
	const opened = data?.connections.find((c) => c.id === openId) ?? null;

	const startSync = async () => {
		if (syncLocked.current) return;
		syncLocked.current = true;
		setSyncMessage(null);
		try {
			await sync.mutateAsync();
		} catch (error) {
			setSyncMessage(syncErrorMessage(error));
		} finally {
			syncLocked.current = false;
		}
	};

	return (
		<Screen>
			<ScrollView
				keyboardShouldPersistTaps="handled"
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
						Bancos e cartões
					</Text>
					<Text variant="body" tone="secondary">
						Conectados pelo Meu Pluggy. Atualizam sozinhos uma vez por dia.
					</Text>
				</View>

				{status.phase === "loading" ? (
					<>
						<Skeleton height={spacing.xxxl * 3} />
						<Skeleton height={spacing.xxxl * 4} />
					</>
				) : null}
				{status.phase === "error" ? <ErrorState message={status.message} onRetry={status.retry} /> : null}

				{data ? (
					<>
						{!data.keysConfigured ? (
							<Panel>
								<Text variant="bodyStrong" accessibilityRole="header">
									{KEYS_MISSING_TITLE}
								</Text>
								<Text variant="caption" tone="secondary">
									{KEYS_MISSING_MESSAGE}
								</Text>
								<Button
									label="Servidor e chaves"
									variant="secondary"
									compact
									onPress={() => router.push("/configuracoes/servidor")}
									style={{ alignSelf: "flex-start" }}
								/>
							</Panel>
						) : null}

						{data.connections.length > 0 ? (
							<Panel>
								<View accessible accessibilityLiveRegion="polite" style={{ gap: spacing.xs }}>
									<Text variant="bodyStrong">{card?.title}</Text>
									<Text variant="caption" tone="secondary">
										{card?.caption}
									</Text>
								</View>
								{syncMessage ? (
									<View accessibilityRole="alert" accessibilityLiveRegion="polite">
										<Text variant="caption" tone="secondary">
											{syncMessage}
										</Text>
									</View>
								) : null}
								<Button
									label={syncButtonLabel(data.sync)}
									variant="secondary"
									loading={sync.isPending || data.sync === "queued" || data.sync === "running"}
									disabled={!canSync(data)}
									onPress={() => void startSync()}
								/>
							</Panel>
						) : null}

						{data.connections.length > 0 ? (
							<SettingsSection title="Conexões">
								{data.connections.map((c, i) => {
									const name = connectionName(c);
									return (
										<SettingsRow
											key={c.id}
											leading={
												<BankLogo
													initial={name.charAt(0).toLocaleUpperCase("pt-BR")}
													color={bankColorByName(name)}
													size={36}
												/>
											}
											title={name}
											caption={connectionStatusLine(c, now)}
											onPress={() => setOpenId(c.id)}
											last={i === data.connections.length - 1}
										/>
									);
								})}
							</SettingsSection>
						) : (
							<Panel>
								<Text variant="bodyStrong">{EMPTY_TITLE}</Text>
								<Text variant="caption" tone="secondary">
									{EMPTY_MESSAGE}
								</Text>
							</Panel>
						)}

						<Button label="Adicionar conexão" icon="mais" onPress={() => setAdding(true)} />
					</>
				) : null}
			</ScrollView>

			<AddConnectionSheet
				visible={adding}
				add={async (body) => {
					await add.mutateAsync(body);
				}}
				onClose={() => setAdding(false)}
			/>
			<ConnectionSheet
				connection={opened}
				statusLine={opened ? connectionStatusLine(opened, now) : ""}
				remove={async (id) => {
					await remove.mutateAsync(id);
				}}
				onClose={() => setOpenId(null)}
			/>
		</Screen>
	);
}
