import { spacing } from "@orbita/tokens";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { useState } from "react";
import { Platform, View } from "react-native";
import { Button, Text, TextField } from "../../ui/index.ts";
import { openRepoLink } from "./open-link.ts";
import { Note, SubScreen } from "./parts.tsx";
import { buildIssueUrl, DESCRIPTION_MAX, type TechInfo } from "./report-model.ts";
import { SettingsRow, SettingsSection, StaticSwitch } from "./SettingsRows.tsx";

/** Só versão, plataforma, sistema e modelo. Nada de nome do aparelho, endereço do servidor, valores ou contas. */
function readTechInfo(): TechInfo {
	return {
		appVersion: Constants.expoConfig?.version ?? null,
		platform: Platform.OS,
		osVersion: Device.osVersion ?? (Platform.OS === "web" ? null : String(Platform.Version)),
		deviceModel: Device.modelName ?? null,
	};
}

/**
 * Tela "Reportar um problema" (Figma 44:1016). Monta o texto e abre uma issue pré-preenchida no GitHub
 * (ali-ali18/Orbita), no navegador: o dono revisa e envia lá, com a conta dele. O app não manda nada sozinho e o
 * GitHub não aceita anexo por endereço: o print se arrasta na página da issue.
 */
export function ReportScreen() {
	const [description, setDescription] = useState("");
	const [withTech, setWithTech] = useState(true);
	const [message, setMessage] = useState<string | null>(null);

	const open = async () => {
		const built = buildIssueUrl({ description, tech: withTech ? readTechInfo() : null });
		if (!built.ok) {
			setMessage(built.message);
			return;
		}
		setMessage(null);
		if (!(await openRepoLink(built.url))) setMessage("Não consegui abrir o navegador.");
	};

	return (
		<SubScreen title="Reportar um problema" subtitle="Vira uma issue no repositório do projeto, no GitHub.">
			<View style={{ gap: spacing.sm }}>
				<TextField
					value={description}
					onChangeText={(text) => {
						setDescription(text);
						setMessage(null);
					}}
					placeholder="O que aconteceu?"
					accessibilityLabel="O que aconteceu"
					multiline
					maxLength={DESCRIPTION_MAX}
					style={{ minHeight: 160 }}
				/>
				<Text variant="caption" tone="tertiary" style={{ textAlign: "right" }}>
					{`${description.length}/${DESCRIPTION_MAX}`}
				</Text>
			</View>

			<SettingsSection>
				<SettingsRow
					last
					title="Incluir dados técnicos"
					caption="Versão do app, sistema e modelo do aparelho. Nunca valores ou nomes."
					chevron={false}
					toggled={withTech}
					onPress={() => setWithTech(!withTech)}
					trailing={<StaticSwitch on={withTech} />}
				/>
			</SettingsSection>

			{message ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
					{message}
				</Text>
			) : null}
			<Button label="Abrir no GitHub" onPress={() => void open()} />
			<Note
				icon="info"
				text={`A issue é pública. Não escreva valores, nomes nem dados de contas. Para anexar um print, arraste a imagem na página do GitHub (apague antes o que for pessoal).`}
			/>
		</SubScreen>
	);
}
