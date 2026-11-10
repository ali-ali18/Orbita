import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ScrollView, View } from "react-native";
import { toLoadable } from "../../lib/loadable.ts";
import {
	BankLogo,
	Button,
	ErrorState,
	IconButton,
	Screen,
	Skeleton,
	Text,
	TOP_FADE,
} from "../../ui/index.ts";
import { usePendingTransactions } from "../review/queries.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { SettingsRow, SettingsSection } from "../settings/SettingsRows.tsx";
import { bankBadge } from "../summary/summary-model.ts";
import {
	bankColorByName,
	canSync,
	connectionCaption,
	connectionName,
	connectionStatusLine,
	disconnectedConnections,
	EMPTY_MESSAGE,
	EMPTY_TITLE,
	isSlowSync,
	isSyncActive,
	KEYS_MISSING_MESSAGE,
	KEYS_MISSING_TITLE,
	REIMPORT_BUTTON,
	type SyncState,
	syncAnnouncement,
	syncButtonLabel,
	syncCardText,
	syncErrorMessage,
} from "./banks-model.ts";
import { ConnectExplainer } from "./ConnectExplainer.tsx";
import { ConnectedScreen } from "./ConnectedScreen.tsx";
import { AddConnectionSheet, ConnectionSheet, ReimportSheet } from "./ConnectionSheets.tsx";
import { ConnectionUsageCard } from "./ConnectionUsageCard.tsx";
import {
	canConnect,
	connectButtonLabel,
	connectionArrived,
	connectionUsage,
	isWaitingForConnect,
	MANUAL_BUTTON,
	returnedToApp,
} from "./connect-model.ts";
import { isReadyToCelebrate, newConnection } from "./connected-model.ts";
import { usePluggyActions, usePluggyImportedCount, usePluggyStatus } from "./queries.ts";
import { ReconnectBanner } from "./ReconnectBanner.tsx";
import { useConnectLauncher } from "./use-connect.ts";
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
	const { sync, reimport, add, rename, remove } = usePluggyActions();
	const [adding, setAdding] = useState(false);
	const [reimporting, setReimporting] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const [syncMessage, setSyncMessage] = useState<string | null>(null);
	const syncLocked = useRef(false);
	const [announcement, setAnnouncement] = useState("");
	const previousSync = useRef<SyncState | undefined>(undefined);
	const [activeSince, setActiveSince] = useState<number | null>(null);

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

	const connectionIds = (data?.connections ?? []).map((c) => c.id);
	const {
		ask: askConnect,
		confirm: confirmConnect,
		dismiss: dismissConnect,
		explaining,
		pending: connectPending,
		message: connectMessage,
		setMessage: setConnectMessage,
		opened: connectOpened,
	} = useConnectLauncher(connectionIds);
	// Conexão nova que acabou de chegar do Pluggy Connect: vira a tela "Pronto" quando a sincronização termina.
	const [justConnectedId, setJustConnectedId] = useState<string | null>(null);
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
	}, [refetch, connectOpened]);
	const connections = data?.connections;
	useEffect(() => {
		const opened = connectOpened.current;
		if (opened && connections && connectionArrived(opened.ids.length, connections.length)) {
			const fresh = newConnection(opened.ids, connections);
			connectOpened.current = null;
			setConnectMessage(null);
			if (fresh) setJustConnectedId(fresh.id);
		}
	}, [connections, connectOpened, setConnectMessage]);

	const justConnected = data?.connections.find((c) => c.id === justConnectedId) ?? null;
	const celebrating = justConnected !== null && data !== null && isReadyToCelebrate(justConnected, data.sync);
	const importedQ = usePluggyImportedCount(celebrating);
	const pendingQ = usePendingTransactions();
	const disconnected = data ? disconnectedConnections(data.connections) : [];

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

	if (explaining) {
		return (
			<ConnectExplainer
				bank={explaining.bank}
				loading={connectPending}
				onOpen={confirmConnect}
				onClose={dismissConnect}
			/>
		);
	}

	if (isUnreachableQuery(statusQ)) return <ServerDownScreen onRetry={() => statusQ.refetch()} />;

	if (justConnected && data && isReadyToCelebrate(justConnected, data.sync)) {
		return (
			<ConnectedScreen
				connection={justConnected}
				connections={data.connections.length}
				imported={importedQ.data?.count ?? null}
				pending={pendingQ.data ? pendingQ.data.transactions.length : null}
				onReview={() => router.replace("/revisao")}
				onHome={() => router.replace("/")}
				onLater={() => setJustConnectedId(null)}
			/>
		);
	}

	return (
		<Screen fadeTop>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{
					paddingTop: TOP_FADE,
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
						{disconnected.map((c) => (
							<ReconnectBanner
								key={c.id}
								connection={c}
								now={now}
								loading={connectPending}
								onReconnect={() => askConnect(connectionName(c), c.id)}
							/>
						))}
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

						<ConnectionUsageCard usage={connectionUsage(data.connections.length)} />

						{data.connections.length > 0 ? (
							<SettingsSection title="Conexões">
								{data.connections.map((c, i) => {
									const name = connectionName(c);
									return (
										<SettingsRow
											key={c.id}
											leading={<BankLogo {...bankBadge({ name })} color={bankColorByName(name)} size={36} />}
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
							label={connectButtonLabel(data.connections.length)}
							icon="mais"
							loading={connectPending}
							disabled={!canConnect(data)}
							onPress={() => askConnect()}
						/>
						<Button label={MANUAL_BUTTON} variant="secondary" onPress={() => setAdding(true)} />
						{data.connections.length > 0 ? (
							<Button
								label="Diagnóstico da conexão"
								variant="secondary"
								disabled={!data.keysConfigured}
								onPress={() => router.push("/configuracoes/diagnostico-pluggy")}
							/>
						) : null}
						{data.connections.length > 0 ? (
							<Button
								label={REIMPORT_BUTTON}
								variant="secondary"
								disabled={!canSync(data)}
								onPress={() => setReimporting(true)}
							/>
						) : null}
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
			<ReimportSheet
				visible={reimporting}
				reimport={async () => {
					await reimport.mutateAsync();
				}}
				onClose={() => setReimporting(false)}
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
