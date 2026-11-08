import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { toLoadable } from "../../lib/loadable.ts";
import { ErrorState, LetterAvatar, Skeleton, Text } from "../../ui/index.ts";
import { Note, SubScreen, TextEditSheet } from "./parts.tsx";
import { useProfile, useUpdateProfile } from "./preferences-queries.ts";
import { avatarInitial, parseDeviceName, parseDisplayName } from "./profile-model.ts";
import { SettingsRow, SettingsSection } from "./SettingsRows.tsx";

type Editing = "name" | "device" | null;

/**
 * Tela "Perfil" (Figma 43:1013). O nome é como a Órbita te chama ("Olá, Alisson") e vive no servidor; o
 * aparelho é o nome deste celular na lista de aparelhos conectados. Não há conta, e-mail nem foto: o Órbita é
 * de um dono só, então essas linhas do Figma não existem aqui.
 */
export function ProfileScreen() {
	const profileQ = useProfile();
	const update = useUpdateProfile();
	const [editing, setEditing] = useState<Editing>(null);
	const profile = toLoadable(profileQ);

	return (
		<SubScreen title="Perfil">
			{profile.phase === "error" ? (
				<ErrorState message={profile.message} onRetry={profile.retry} />
			) : profile.phase === "loading" ? (
				<View style={{ gap: spacing.md, paddingTop: spacing.md }}>
					<Skeleton height={spacing.xxxl} />
					<Skeleton height={spacing.xxxl} />
				</View>
			) : (
				<>
					<View style={{ alignItems: "center", paddingVertical: spacing.lg }}>
						<LetterAvatar letter={avatarInitial(profile.data.displayName)} size={spacing.xxxl * 3} />
					</View>
					<SettingsSection>
						<SettingsRow
							title="Como a Órbita te chama"
							value={profile.data.displayName ?? "Sem nome"}
							onPress={() => setEditing("name")}
						/>
						<SettingsRow
							title="Este aparelho"
							value={profile.data.deviceName}
							onPress={() => setEditing("device")}
						/>
						<SettingsRow info last title="Fuso horário" value="São Paulo" />
					</SettingsSection>
					<Note
						icon="cadeado"
						text={`Seus dados ficam no seu servidor. Nada vai para terceiros além das chamadas da IA e do Meu Pluggy.`}
					/>
					<Text variant="caption" tone="tertiary">
						O nome aparece na saudação do Início e no chat. O nome do aparelho aparece em Servidor e chaves.
					</Text>
				</>
			)}

			<TextEditSheet
				visible={editing === "name"}
				title="Como a Órbita te chama"
				hint="Aparece na saudação do Início e do chat."
				initial={profileQ.data?.displayName ?? ""}
				placeholder="Seu nome"
				parse={parseDisplayName}
				onSave={(displayName) => update.mutateAsync({ displayName })}
				onClear={() => update.mutateAsync({ displayName: null })}
				clearLabel="Remover nome"
				onClose={() => setEditing(null)}
			/>
			<TextEditSheet
				visible={editing === "device"}
				title="Nome deste aparelho"
				hint="Como este celular aparece na lista de aparelhos conectados."
				initial={profileQ.data?.deviceName ?? ""}
				placeholder="Ex.: Galaxy S24"
				parse={parseDeviceName}
				onSave={(deviceName) => update.mutateAsync({ deviceName })}
				onClose={() => setEditing(null)}
			/>
		</SubScreen>
	);
}
