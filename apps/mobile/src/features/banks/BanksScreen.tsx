import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, ScrollView, View } from "react-native";
import { toLoadable } from "../../lib/loadable.ts";
import { useSession } from "../../lib/session.tsx";
import { BankLogo, Button, ErrorState, IconButton, Screen, Skeleton, Text } from "../../ui/index.ts";
import { SettingsRow, SettingsSection } from "../settings/SettingsRows.tsx";
import {
	bankColorByName,
	canSync,
	connectionCaption,
	connectionName,
	connectionStatusLine,
	EMPTY_MESSAGE,
	EMPTY_TITLE,
	isSlowSync,
	isSyncActive,
	KEYS_MISSING_MESSAGE,
	KEYS_MISSING_TITLE,
	type SyncState,
	syncAnnouncement,
	syncButtonLabel,
	syncCardText,
	syncErrorMessage,
} from "./banks-model.ts";
import { AddConnectionSheet, ConnectionSheet } from "./ConnectionSheets.tsx";
import {
	CONNECT_BUTTON,
	CONNECT_OPEN_FAILED,
	CONNECT_PENDING_HINT,
	canConnect,
	connectErrorMessage,
	connectionArrived,
	connectUrl,
	isWaitingForConnect,
	MANUAL_BUTTON,
	returnedToApp,
} from "./connect-model.ts";
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
	const { sync, add, rename, remove, connect } = usePluggyActions();
	const { baseUrl } = useSession();
	const [adding, setAdding] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const [syncMessage, setSyncMessage] = useState<string | null>(null);
	const syncLocked = useRef(false);
	const [announcement, setAnnouncement] = useState("");
	const previousSync = useRef<SyncState | undefined>(undefined);
	const [activeSince, setActiveSince] = useState<number | null>(null);
	const [connectMessage, setConnectMessage] = useState<string | null>(null);
	const connectLocked = useRef(false);
	// Quando a página do Pluggy foi aberta e quantas conexões havia: ao voltar ao app, confere se apareceu uma.
	const connectOpened = useRef<{ at: number; count: number } | null>(null);

	const status = toLoadable(statusQ);
	const data = status.phase === "ready" ? status.data : null;
	const sinceData = data?.sync;
	const keys = data?.keysConfigured;

	// O aviso errado de antes (sem chaves, falha de sync) some quando o estado muda ou ao voltar para a tela.
	useEffect(() => {
		if (sinceData !== undefined || keys !== undefined) setSyncMessage(null);
	}, [sinceData, keys]);
	useFocusEffect(useCallback(() => setSyncMessage(null), []));

	// Leitor de tela: avisa só a troca de estado (na fila, sincronizando, concluído), nunca o "há N min".
	useEffect(() => {
		if (!data) return;
		const text = syncAnnouncement(previousSync.current, data);
		previousSync.current = data.sync;
		if (text && previousSync.current !== undefined) setAnnouncement(text);
	}, [data]);

	// Quando a sincronização em andamento foi vista pela primeira vez (para o aviso de demora).
	useEffect(() => {
		setActiveSince((prev) => (isSyncActive(sinceData) ? (prev ?? Date.now()) : null));
	}, [sinceData]);
	const slow = isSlowSync(activeSince, now.getTime());

	const connectionCount = data?.connections.length;
	const { refetch } = statusQ;
	useEffect(() => {
		let prev: string = AppState.currentState ?? "active";
		const sub = AppState.addEventListener("change", (next) => {
			const back = returnedToApp(prev, next);
			prev = next;
			const opened = connectOpened.current;
			if (back && opened && isWaitingForConnect(opened.at, Date.now())) void refetch();
		});
		return () => sub.remove();
	}, [refetch]);
	useEffect(() => {
		const opened = connectOpened.current;
		if (opened && connectionCount !== undefined && connectionArrived(opened.count, connectionCount)) {
			connectOpened.current = null;
			setConnectMessage(null);
		}
	}, [connectionCount]);

	const startConnect = async () => {
		if (connectLocked.current || baseUrl === null) return;
		connectLocked.current = true;
		setConnectMessage(null);
		try {
			const { path } = await connect.mutateAsync();
			const url = connectUrl(baseUrl, path);
			if (!url) throw new Error(CONNECT_OPEN_FAILED);
			connectOpened.current = { at: Date.now(), count: connectionCount ?? 0 };
			await Linking.openURL(url);
			setConnectMessage(CONNECT_PENDING_HINT);
		} catch (error) {
			connectOpened.current = null;
			setConnectMessage(
				error instanceof Error && error.message === CONNECT_OPEN_FAILED
					? CONNECT_OPEN_FAILED
					: connectErrorMessage(error),
			);
		} finally {
			connectLocked.current = false;
		}
	};

	const card = data ? syncCardText(data, now, slow) : null;
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
								<View accessible style={{ gap: spacing.xs }}>
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
									loading={sync.isPending}
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
											caption={connectionCaption(c, now)}
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

						{connectMessage ? (
							<View accessibilityRole="alert" accessibilityLiveRegion="polite">
								<Text variant="caption" tone="secondary">
									{connectMessage}
								</Text>
							</View>
						) : null}
						<Button
							label={CONNECT_BUTTON}
							icon="mais"
							loading={connect.isPending}
							disabled={!canConnect(data)}
							onPress={() => void startConnect()}
						/>
						<Button label={MANUAL_BUTTON} variant="secondary" onPress={() => setAdding(true)} />
					</>
				) : null}
			</ScrollView>

			<Text
				accessibilityLiveRegion="polite"
				style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}
			>
				{announcement}
			</Text>
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
				rename={async (id, label) => {
					await rename.mutateAsync({ id, label });
				}}
				remove={async (id) => {
					await remove.mutateAsync(id);
				}}
				onClose={() => setOpenId(null)}
			/>
		</Screen>
	);
}
