import type { NotificationSettingsPatchBody } from "@orbita/shared";
import { NOTIFICATION_APP_LABELS, NOTIFICATION_APPS } from "@orbita/shared";
import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { BankLogo, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { Note, SubScreen } from "./parts.tsx";
import { NOTIFICATION_STATUS, NOTIFICATION_STATUS_DETAIL, toggleApp } from "./preferences-model.ts";
import { useNotificationSettings, useUpdateNotificationSettings } from "./preferences-queries.ts";
import { SettingsRow, SettingsSection, StaticSwitch } from "./SettingsRows.tsx";

/**
 * Tela "Notificações do celular" (Figma 43:724). A leitura das notificações do banco AINDA NÃO existe: a tela
 * guarda as escolhas no servidor (para quando a leitura estiver pronta) e diz isso com todas as letras no topo.
 */
export function NotificationsScreen() {
	const settingsQ = useNotificationSettings();
	const update = useUpdateNotificationSettings();
	const [message, setMessage] = useState<string | null>(null);
	const settings = toLoadable(settingsQ);

	const save = (patch: NotificationSettingsPatchBody) => {
		// Um toque por vez: a resposta do servidor é quem define o estado das chaves.
		if (update.isPending) return;
		setMessage(null);
		update.mutate(patch, { onError: (error) => setMessage(errorMessage(error)) });
	};

	return (
		<SubScreen
			title="Notificações do celular"
			subtitle="Quando a leitura estiver pronta, as notificações dos bancos viram lançamentos na hora."
		>
			<Note icon="alerta" alert text={`${NOTIFICATION_STATUS} ${NOTIFICATION_STATUS_DETAIL}`} />

			{settings.phase === "error" ? (
				<ErrorState message={settings.message} onRetry={settings.retry} />
			) : settings.phase === "loading" ? (
				<View style={{ gap: spacing.md, paddingTop: spacing.md }}>
					<Skeleton height={spacing.xxxl} />
					<Skeleton height={spacing.xxxl * 3} />
				</View>
			) : (
				<>
					<SettingsSection>
						<SettingsRow
							last
							icon="notificacao"
							title="Acesso às notificações"
							caption="Só Android · o texto vai direto para o seu servidor"
							chevron={false}
							toggled={settings.data.capture}
							onPress={() => save({ capture: !settings.data.capture })}
							trailing={<StaticSwitch on={settings.data.capture} />}
						/>
					</SettingsSection>

					<SettingsSection title="Apps que eu leio">
						{NOTIFICATION_APPS.map((app, i) => (
							<SettingsRow
								key={app}
								leading={<BankLogo {...bankBadge({ name: NOTIFICATION_APP_LABELS[app] })} size={32} />}
								title={NOTIFICATION_APP_LABELS[app]}
								chevron={false}
								toggled={settings.data.apps.includes(app)}
								onPress={() => save({ apps: toggleApp(settings.data.apps, app) })}
								trailing={<StaticSwitch on={settings.data.apps.includes(app)} />}
								last={i === NOTIFICATION_APPS.length - 1}
							/>
						))}
					</SettingsSection>

					<SettingsSection title="Quando não entendo">
						<SettingsRow
							last
							title="Mandar para revisão"
							caption="Fica em Para revisar até você confirmar"
							chevron={false}
							toggled={settings.data.toReview}
							onPress={() => save({ toReview: !settings.data.toReview })}
							trailing={<StaticSwitch on={settings.data.toReview} />}
						/>
					</SettingsSection>
					{message ? (
						<Text
							variant="caption"
							tone="secondary"
							accessibilityRole="alert"
							accessibilityLiveRegion="polite"
						>
							{message}
						</Text>
					) : null}
				</>
			)}
		</SubScreen>
	);
}
