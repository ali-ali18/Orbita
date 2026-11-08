import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button, Text } from "../../ui/index.ts";
import { openRepoLink } from "./open-link.ts";
import { Note, SubScreen } from "./parts.tsx";
import { BACKUP_DOCS_URL } from "./report-model.ts";
import { SettingsRow, SettingsSection } from "./SettingsRows.tsx";

const STEPS = [
	"No painel do Dokploy, abra o Postgres do Órbita e crie um backup agendado.",
	"Escolha um destino S3 em um bucket privado: o backup tem todos os seus dados financeiros.",
	"Defina o horário (um por dia basta) e por quantos dias guardar.",
	"De vez em quando, teste restaurar um backup num banco de teste.",
] as const;

/**
 * Tela "Backup" (Figma 44:947). O backup do banco é feito pelo Dokploy, no servidor: o app NÃO agenda, NÃO dispara e
 * NÃO consegue ver se ele rodou. Por isso a tela mostra o que é e como configurar, sem "último backup" inventado nem
 * botão que finja fazer algo. Para uma cópia pelo celular, existe Exportar tudo (que não é backup completo).
 */
export function BackupScreen() {
	const router = useRouter();
	const [message, setMessage] = useState<string | null>(null);

	const openDocs = async () => {
		setMessage(null);
		if (!(await openRepoLink(BACKUP_DOCS_URL))) setMessage("Não consegui abrir o navegador.");
	};

	return (
		<SubScreen title="Backup" subtitle="Cópia do banco de dados do seu servidor, guardada fora da VPS.">
			<View
				style={{
					backgroundColor: colors.surface,
					borderRadius: radius.block,
					padding: spacing.xl,
					gap: spacing.sm,
				}}
			>
				<Text variant="bodyStrong" accessibilityRole="header">
					Quem faz o backup é o Dokploy
				</Text>
				<Text variant="caption" tone="secondary">
					O app não agenda nem dispara backups e não sabe se um rodou. Confira no painel do Dokploy se o
					último backup terminou sem erro.
				</Text>
			</View>

			<SettingsSection title="Como configurar">
				<View style={{ padding: spacing.lg, gap: spacing.md }}>
					{STEPS.map((step, i) => (
						<View key={step} style={{ flexDirection: "row", gap: spacing.md }}>
							<Text variant="caption" tone="tertiary">{`${i + 1}.`}</Text>
							<View style={{ flex: 1 }}>
								<Text variant="body">{step}</Text>
							</View>
						</View>
					))}
				</View>
			</SettingsSection>

			<Button label="Abrir instruções no GitHub" variant="secondary" onPress={() => void openDocs()} />
			{message ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
					{message}
				</Text>
			) : null}

			<SettingsSection title="Uma cópia pelo celular">
				<SettingsRow
					last
					icon="baixar"
					title="Exportar tudo"
					caption="CSV ou JSON dos seus lançamentos. Não é um backup completo: não leva as chaves nem restaura o banco."
					onPress={() => router.push("/configuracoes/exportar")}
				/>
			</SettingsSection>
			<Note
				icon="info"
				text={`Nada aqui é enviado a terceiros: o backup vai do seu servidor direto para o destino que você escolher.`}
			/>
		</SubScreen>
	);
}
