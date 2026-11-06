import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { useMutation } from "@tanstack/react-query";
import * as Device from "expo-device";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { ApiError, claimPairing } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { getItem, KEYS } from "../../lib/storage.ts";
import { Button, familyByWeight, Screen, Text } from "../../ui/index.ts";
import { CodeInput } from "./CodeInput.tsx";
import { isCodeComplete, normalizeServerUrl } from "./pairing-model.ts";

/** Nome do aparelho que aparece em "aparelhos conectados": o modelo, ou "Android". */
function deviceName(): string {
	if (Platform.OS === "web") return "Navegador (prévia)";
	return (Device.modelName ?? "Android").slice(0, 60);
}

function Label({ text }: { text: string }) {
	return (
		<Text variant="caption" tone="secondary" style={{ marginBottom: spacing.sm }}>
			{text}
		</Text>
	);
}

export function PairingForm() {
	const router = useRouter();
	const { signIn, notice, clearNotice } = useSession();
	const [serverText, setServerText] = useState("");
	const [code, setCode] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [serverFocused, setServerFocused] = useState(false);

	// Endereço usado da última vez (depois de sair, o campo já vem preenchido).
	useEffect(() => {
		getItem(KEYS.baseUrl)
			.then((saved) => saved && setServerText((current) => current || saved))
			.catch(() => {});
	}, []);

	const claim = useMutation({
		mutationFn: async () => {
			const server = normalizeServerUrl(serverText, { dev: __DEV__ });
			if (!server.ok) throw new ApiError(server.message, null, "endereco_invalido");
			const result = await claimPairing(server.url, code, deviceName());
			await signIn(server.url, result.token);
		},
		onSuccess: () => router.replace("/"),
		onError: (error) =>
			setMessage(error instanceof ApiError ? error.message : "Algo deu errado ao conectar. Tente de novo."),
	});

	const ready = serverText.trim().length > 0 && isCodeComplete(code);
	const submit = () => {
		if (!ready || claim.isPending) return;
		setMessage(null);
		clearNotice();
		claim.mutate();
	};

	return (
		<Screen
			footer={
				<View style={{ paddingHorizontal: spacing.lg }}>
					<Button label="Conectar" onPress={submit} disabled={!ready} loading={claim.isPending} />
				</View>
			}
		>
			<KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
				<ScrollView
					contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxxl }}
					keyboardShouldPersistTaps="handled"
				>
					<Text variant="greeting" accessibilityRole="header">
						Onde ficam seus dados?
					</Text>
					<Text variant="body" tone="secondary" style={{ marginTop: spacing.sm, marginBottom: spacing.xxl }}>
						Conecte o app ao seu servidor. É ele que guarda tudo e conversa com o banco e com a IA.
					</Text>

					<Label text="Endereço do servidor" />
					<TextInput
						value={serverText}
						onChangeText={setServerText}
						onFocus={() => setServerFocused(true)}
						onBlur={() => setServerFocused(false)}
						placeholder="https://financas.seudominio.dev"
						placeholderTextColor={colors.textTertiary}
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						inputMode="url"
						textContentType="URL"
						accessibilityLabel="Endereço do servidor"
						style={{
							height: 56,
							borderRadius: radius.inner,
							backgroundColor: colors.surface,
							borderWidth: 1,
							borderColor: serverFocused ? colors.accent : colors.border,
							paddingHorizontal: spacing.lg,
							marginBottom: spacing.xl,
							color: colors.text,
							fontFamily: familyByWeight[400],
							fontSize: typography.body.fontSize,
						}}
					/>

					<Label text="Código de pareamento" />
					<CodeInput value={code} onChange={setCode} onSubmit={submit} />

					{notice ? (
						<View
							accessibilityRole="alert"
							style={{
								marginTop: spacing.xl,
								padding: spacing.lg,
								borderRadius: radius.inner,
								borderWidth: 1,
								borderColor: colors.border,
								backgroundColor: colors.surface,
							}}
						>
							<Text variant="body">{notice}</Text>
						</View>
					) : null}

					{message ? (
						<View
							accessibilityRole="alert"
							style={{
								marginTop: spacing.xl,
								padding: spacing.lg,
								borderRadius: radius.inner,
								borderWidth: 1,
								borderColor: colors.textSecondary,
								backgroundColor: colors.surface,
								gap: spacing.xs,
							}}
						>
							<Text variant="bodyStrong">Não deu para conectar</Text>
							<Text variant="body" tone="secondary">
								{message}
							</Text>
						</View>
					) : null}

					<View
						style={{
							marginTop: spacing.xl,
							padding: spacing.lg,
							borderRadius: radius.inner,
							backgroundColor: colors.surface,
							gap: spacing.xs,
						}}
					>
						<Text variant="caption" tone="secondary">
							Onde pegar o código
						</Text>
						<Text variant="caption">
							O código aparece sozinho nos logs do servidor. No Dokploy: aba Logs do serviço api.
						</Text>
						<Text variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
							Vale por 10 minutos e é renovado automaticamente enquanto nenhum aparelho estiver conectado.
						</Text>
						<Text variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
							Numa VPS com terminal, também dá para gerar um na hora:
						</Text>
						<Text variant="caption">docker compose exec api parear</Text>
					</View>
				</ScrollView>
			</KeyboardAvoidingView>
		</Screen>
	);
}
