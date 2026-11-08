import { colors, layout, spacing } from "@orbita/tokens";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSession } from "../../lib/session.tsx";
import { Icon, IconButton, LetterAvatar, OrbitaAvatar, Screen, Text, TOP_FADE } from "../../ui/index.ts";
import { useOnboardingPhase } from "../onboarding/flag.ts";
import { showsSetupInSettings } from "../onboarding/model.ts";
import { SettingsRow, SettingsSection, StaticSwitch } from "./SettingsRows.tsx";
import { SignOutDialog } from "./SignOutDialog.tsx";

/** "https://financas.seudominio.dev" -> "financas.seudominio.dev" (valor curto da linha). */
function hostOf(baseUrl: string | null): string | undefined {
	if (!baseUrl) return undefined;
	return baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * Tela "Configurações" (Figma 41:605). "Bancos e cartões" e "Servidor e chaves" têm tela; os outros itens aparecem como no
 * Figma, esmaecidos e sem toque, até existirem. Quem já usava o app e não fez a configuração inicial vê essa entrada;
 * depois de feita, ela some. O que o Figma mostra com número de exemplo (4 bancos, 3 apps…) não aparece.
 */
export function SettingsScreen() {
	const router = useRouter();
	const { baseUrl } = useSession();
	const [confirmingSignOut, setConfirmingSignOut] = useState(false);
	const version = Constants.expoConfig?.version;
	const phase = useOnboardingPhase();
	const showSetup = phase !== "loading" && showsSetupInSettings(phase);

	return (
		<Screen fadeTop>
			<ScrollView
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
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
					/>
				</View>

				<View style={{ alignItems: "center", gap: spacing.md, paddingBottom: spacing.sm }}>
					<LetterAvatar letter="V" size={spacing.xxxl * 3} />
					<Text variant="numberMedium" accessibilityRole="header">
						Configurações
					</Text>
				</View>

				{showSetup ? (
					<SettingsSection title="Primeiros passos">
						<SettingsRow
							icon="brilho"
							title="Configuração inicial"
							caption="Bancos, notificações e orçamento"
							onPress={() => router.push("/configuracoes/primeira-vez")}
							last
						/>
					</SettingsSection>
				) : null}

				<SettingsSection title="Fontes de dados">
					<SettingsRow
						icon="banco"
						title="Bancos e cartões"
						onPress={() => router.push("/configuracoes/bancos")}
					/>
					<SettingsRow icon="notificacao" title="Notificações do celular" />
					<SettingsRow icon="escanear" title="Comprovantes e arquivos" last />
				</SettingsSection>

				<SettingsSection title="Organização">
					<SettingsRow leading={<OrbitaAvatar size={20} />} title="Agentes" />
					<SettingsRow icon="assinatura" title="Assinaturas" onPress={() => router.push("/assinaturas")} />
					<SettingsRow
						icon="alvo"
						title="Orçamento do mês"
						onPress={() => router.push("/configuracoes/orcamento")}
					/>
					<SettingsRow icon="etiqueta" title="Categorias e regras" last />
				</SettingsSection>

				<SettingsSection title="Conta">
					<SettingsRow icon="usuario" title="Perfil" />
					<SettingsRow icon="ajustes" title="Preferências" last />
				</SettingsSection>

				<SettingsSection title="Segurança">
					<SettingsRow
						icon="cadeado"
						title="Desbloquear com digital"
						leading={undefined}
						chevron={false}
						trailing={<StaticSwitch on={false} />}
					/>
					<SettingsRow
						icon="olho"
						title="Esconder valores ao abrir"
						chevron={false}
						trailing={<StaticSwitch on={false} />}
					/>
					<SettingsRow
						icon="chave"
						title="Servidor e chaves"
						value={hostOf(baseUrl)}
						onPress={() => router.push("/configuracoes/servidor")}
						last
					/>
				</SettingsSection>

				<SettingsSection title="Seus dados">
					<SettingsRow icon="baixar" title="Exportar tudo" />
					<SettingsRow icon="banco-de-dados" title="Backup" last />
				</SettingsSection>

				<SettingsSection title="Sobre">
					<SettingsRow icon="codigo" title="Código no GitHub" />
					<SettingsRow icon="alerta" title="Reportar um problema" last />
				</SettingsSection>

				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Sair deste aparelho"
					onPress={() => setConfirmingSignOut(true)}
					style={({ pressed }) => ({
						flexDirection: "row",
						alignItems: "center",
						gap: spacing.md,
						minHeight: layout.touchTarget,
						paddingLeft: spacing.xs,
						marginTop: spacing.sm,
						opacity: pressed ? 0.8 : 1,
					})}
				>
					<Icon name="sair" size={20} color={colors.textSecondary} />
					<Text variant="body" tone="secondary">
						Sair deste aparelho
					</Text>
				</Pressable>
				{version ? (
					<Text variant="caption" tone="tertiary" style={{ textAlign: "center" }}>
						{`v${version} · código aberto`}
					</Text>
				) : null}
			</ScrollView>

			<SignOutDialog visible={confirmingSignOut} onCancel={() => setConfirmingSignOut(false)} />
		</Screen>
	);
}
