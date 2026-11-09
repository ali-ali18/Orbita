import {
	NOTIFICATION_APP_LABELS,
	NOTIFICATION_APPS,
	NOTIFICATION_APPS_DEFAULT,
	type NotificationApp,
	type NotificationInboxItemDto,
	type NotificationSettingsDto,
	type NotificationSettingsPatchBody,
} from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { BankLogo, Button, ErrorState, IconButton, Skeleton, Text } from "../../ui/index.ts";
import {
	captureView,
	deliveryLine,
	inboxCaption,
	isVerifiedApp,
	type NativeStatus,
	RESTRICTED_SETTINGS_HELP,
} from "../notifications/capture-model.ts";
import {
	captureSupported,
	openAccessSettings,
	openAppSettings,
	readCaptureStatus,
} from "../notifications/native.ts";
import {
	useDismissNotification,
	useNotificationInbox,
	useRetryNotificationInbox,
} from "../notifications/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { Note, SubScreen } from "./parts.tsx";
import { toggleApp } from "./preferences-model.ts";
import { useNotificationSettings, useUpdateNotificationSettings } from "./preferences-queries.ts";
import { SettingsRow, SettingsSection, StaticSwitch } from "./SettingsRows.tsx";

/** O que o aparelho diz da leitura (acesso dado, fila). Atualiza ao voltar das configurações do Android. */
function useCaptureStatus() {
	const [status, setStatus] = useState<NativeStatus | null>(() => readCaptureStatus());
	const refresh = useCallback(() => setStatus(readCaptureStatus()), []);
	useEffect(() => {
		refresh();
		const sub = AppState.addEventListener("change", (state) => {
			if (state === "active") refresh();
		});
		return () => sub.remove();
	}, [refresh]);
	return { status, refresh };
}

/**
 * Tela "Notificações do celular" (Figma 43:724). Liga a leitura das notificações dos apps de banco (Android), escolhe
 * quais bancos, diz se falta liberar o acesso no sistema e mostra o que não consegui entender.
 */
export function NotificationsScreen() {
	const settingsQ = useNotificationSettings();
	const update = useUpdateNotificationSettings();
	const inboxQ = useNotificationInbox();
	const retry = useRetryNotificationInbox();
	const dismiss = useDismissNotification();
	const { status, refresh } = useCaptureStatus();
	const [message, setMessage] = useState<string | null>(null);
	const [retryResult, setRetryResult] = useState<string | null>(null);
	const settings = toLoadable(settingsQ);

	const save = (patch: NotificationSettingsPatchBody, then?: () => void) => {
		// Um toque por vez: a resposta do servidor é quem define o estado das chaves.
		if (update.isPending) return;
		setMessage(null);
		update.mutate(patch, {
			onSuccess: () => then?.(),
			onError: (error) => setMessage(errorMessage(error)),
		});
	};

	return (
		<SubScreen
			title="Notificações do celular"
			subtitle="As compras dos bancos entram na hora, sem esperar o Open Finance trazer."
		>
			{settings.phase === "error" ? (
				<ErrorState message={settings.message} onRetry={settings.retry} />
			) : settings.phase === "loading" ? (
				<View style={{ gap: spacing.md, paddingTop: spacing.md }}>
					<Skeleton height={spacing.xxxl} />
					<Skeleton height={spacing.xxxl * 3} />
				</View>
			) : (
				<NotificationsView
					settings={settings.data}
					supported={captureSupported}
					status={status}
					inbox={inboxQ.data ?? []}
					busy={update.isPending}
					message={message}
					retryMessage={retryResult}
					retrying={retry.isPending}
					onToggleCapture={() => {
						const turningOn = !settings.data.capture;
						const patch: NotificationSettingsPatchBody = { capture: turningOn };
						// Primeira vez: já liga os bancos conhecidos (o dono ajusta na lista).
						if (turningOn && settings.data.apps.length === 0) patch.apps = [...NOTIFICATION_APPS_DEFAULT];
						save(patch, () => {
							if (turningOn && captureSupported && readCaptureStatus()?.granted === false)
								openAccessSettings();
							refresh();
						});
					}}
					onToggleApp={(app) => save({ apps: toggleApp(settings.data.apps, app) })}
					onToggleAskFirst={() => save({ askFirst: !settings.data.askFirst })}
					onToggleToReview={() => save({ toReview: !settings.data.toReview })}
					onOpenAccess={openAccessSettings}
					onOpenAppInfo={openAppSettings}
					onRetry={() => {
						setRetryResult(null);
						retry.mutate(undefined, {
							onSuccess: (r) =>
								setRetryResult(
									r.created > 0
										? `${r.created === 1 ? "1 lançamento criado" : `${r.created} lançamentos criados`}.`
										: "Nada novo: cadastre o cartão ou a conta que falta e tente de novo.",
								),
							onError: (error) => setRetryResult(errorMessage(error)),
						});
					}}
					onDismiss={(id) => dismiss.mutate(id)}
				/>
			)}
		</SubScreen>
	);
}

/** A tela sem dados de rede: serve à tela real e à prévia. */
export function NotificationsView({
	settings,
	supported,
	status,
	inbox,
	busy = false,
	message = null,
	retryMessage = null,
	retrying = false,
	now = Date.now(),
	onToggleCapture,
	onToggleApp,
	onToggleAskFirst,
	onToggleToReview,
	onOpenAccess,
	onOpenAppInfo,
	onRetry,
	onDismiss,
}: {
	settings: NotificationSettingsDto;
	supported: boolean;
	status: NativeStatus | null;
	inbox: readonly NotificationInboxItemDto[];
	busy?: boolean;
	message?: string | null;
	retryMessage?: string | null;
	retrying?: boolean;
	now?: number;
	onToggleCapture: () => void;
	onToggleApp: (app: NotificationApp) => void;
	onToggleAskFirst: () => void;
	onToggleToReview: () => void;
	onOpenAccess: () => void;
	onOpenAppInfo: () => void;
	onRetry: () => void;
	onDismiss: (id: string) => void;
}) {
	const view = captureView({ supported, capture: settings.capture, apps: settings.apps, status });
	const delivery = supported && settings.capture ? deliveryLine(status, now) : null;
	return (
		<>
			<Note
				icon={view.alert ? "alerta" : "notificacao"}
				alert={view.alert}
				text={`${view.title}. ${view.detail}`}
			/>

			{view.stage === "needs_access" ? (
				<View style={{ gap: spacing.sm }}>
					<Button label="Abrir configurações do Android" onPress={onOpenAccess} />
					<Text variant="caption" tone="secondary">
						Procure por Órbita e ligue a chave. {RESTRICTED_SETTINGS_HELP}
					</Text>
					<Button variant="secondary" compact label="Abrir informações do app" onPress={onOpenAppInfo} />
				</View>
			) : null}

			{delivery ? (
				<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
					{delivery}
				</Text>
			) : null}

			<SettingsSection>
				<SettingsRow
					last
					icon="notificacao"
					title="Ler notificações dos bancos"
					caption="Só Android · só os apps que você ligar · o texto vai direto para o seu servidor"
					chevron={false}
					toggled={settings.capture}
					onPress={busy ? undefined : onToggleCapture}
					trailing={<StaticSwitch on={settings.capture} />}
				/>
			</SettingsSection>

			<SettingsSection title="Apps que eu leio">
				{NOTIFICATION_APPS.map((app, i) => (
					<SettingsRow
						key={app}
						leading={<BankLogo {...bankBadge({ name: NOTIFICATION_APP_LABELS[app] })} size={32} />}
						title={NOTIFICATION_APP_LABELS[app]}
						caption={isVerifiedApp(app) ? undefined : "Leitor genérico: pode não entender tudo"}
						chevron={false}
						toggled={settings.apps.includes(app)}
						onPress={busy ? undefined : () => onToggleApp(app)}
						trailing={<StaticSwitch on={settings.apps.includes(app)} />}
						last={i === NOTIFICATION_APPS.length - 1}
					/>
				))}
			</SettingsSection>
			<Text variant="caption" tone="tertiary">
				Notificações de qualquer outro app nunca são lidas. Códigos de verificação e senhas são descartados no
				próprio celular.
			</Text>

			<SettingsSection title="Quando eu entendo a compra">
				<SettingsRow
					last
					title="Confirmar antes de lançar"
					caption={
						settings.askFirst
							? "Vai para Para revisar até você confirmar"
							: "Entra na hora, como aguardando o banco, e já conta no gasto"
					}
					chevron={false}
					toggled={settings.askFirst}
					onPress={busy ? undefined : onToggleAskFirst}
					trailing={<StaticSwitch on={settings.askFirst} />}
				/>
			</SettingsSection>

			<SettingsSection title="Quando não entendo">
				<SettingsRow
					last
					title="Guardar para você ver"
					caption="Fica na lista abaixo; desligado, descarto"
					chevron={false}
					toggled={settings.toReview}
					onPress={busy ? undefined : onToggleToReview}
					trailing={<StaticSwitch on={settings.toReview} />}
				/>
			</SettingsSection>

			{inbox.length > 0 ? (
				<SettingsSection title={`Não consegui lançar (${inbox.length})`}>
					<View style={{ padding: spacing.lg, gap: spacing.md }}>
						{inbox.map((item) => (
							<View
								key={item.id}
								style={{
									flexDirection: "row",
									alignItems: "flex-start",
									gap: spacing.md,
									backgroundColor: colors.surface2,
									borderRadius: radius.inner,
									padding: spacing.md,
								}}
							>
								<View style={{ flex: 1, gap: spacing.xs }}>
									<Text variant="micro" tone="secondary">
										{inboxCaption(item, now)}
									</Text>
									<Text variant="caption">{item.title ? `${item.title}: ${item.text}` : item.text}</Text>
								</View>
								<IconButton icon="fechar" label="Descartar notificação" onPress={() => onDismiss(item.id)} />
							</View>
						))}
						<Button variant="secondary" compact label="Tentar de novo" loading={retrying} onPress={onRetry} />
						{retryMessage ? (
							<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
								{retryMessage}
							</Text>
						) : null}
					</View>
				</SettingsSection>
			) : null}

			{message ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
					{message}
				</Text>
			) : null}
		</>
	);
}
