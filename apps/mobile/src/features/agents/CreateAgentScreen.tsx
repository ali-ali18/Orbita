import { AGENT_NAME_MAX, AGENT_TOOL_OPTIONS } from "@orbita/shared";
import { agents as agentTokens, colors, layout, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import {
	Button,
	IconButton,
	OrbitaAvatar,
	Screen,
	Sheet,
	SheetGroup,
	SheetRow,
	Text,
	TextField,
} from "../../ui/index.ts";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { ScheduleFields } from "./AgentSheets.tsx";
import {
	CREATE_EXAMPLES,
	type CreateDraft,
	checkDraft,
	draftName,
	initialDraft,
	scheduleLabel,
	toolsSummary,
} from "./agents-model.ts";
import { useCreateAgent } from "./queries.ts";

/** Uma linha da prévia "Assim ficou": rótulo à esquerda e o valor ao lado (Figma 50:982). */
function PreviewRow({ label, value }: { label: string; value: string }) {
	return (
		<View style={{ flexDirection: "row", gap: spacing.lg }}>
			<Text variant="caption" tone="secondary" style={{ width: 56 }}>
				{label}
			</Text>
			<Text variant="body" style={{ flex: 1 }}>
				{value}
			</Text>
		</View>
	);
}

/**
 * Tela "Novo agente" (Figma 50:982): o dono diz em uma frase o que o agente deve fazer e a prévia mostra o que ele vai
 * ler e quando olha. A frase vira as INSTRUÇÕES do agente (pedido do dono, sempre abaixo das regras do sistema);
 * o app não interpreta a frase. "Ajustar" muda o nome, o que ele lê e a agenda.
 */
export function CreateAgentScreen() {
	const router = useRouter();
	const create = useCreateAgent();
	const [draft, setDraft] = useState<CreateDraft>(initialDraft());
	const [adjusting, setAdjusting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const check = checkDraft(draft);
	const hasText = draft.instructions.trim().length > 0;
	const tokens = agentTokens.custom;

	const close = () => (router.canGoBack() ? router.back() : router.replace("/agentes"));

	const submit = async () => {
		if (!check.ok) {
			setError(check.message);
			return;
		}
		setError(null);
		try {
			const created = await create.mutateAsync(check.body);
			router.replace({ pathname: "/agente", params: { id: created.agent.id } });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Não consegui criar o agente. Tente de novo.");
		}
	};

	return (
		<Screen>
			<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
				<ScrollView
					keyboardShouldPersistTaps="handled"
					contentContainerStyle={{
						paddingTop: layout.statusBar,
						paddingHorizontal: spacing.lg,
						paddingBottom: spacing.xxxl,
						gap: spacing.lg,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", minHeight: layout.touchTarget }}>
						<IconButton icon="fechar" label="Fechar" onPress={close} />
						<Text variant="bodyStrong" accessibilityRole="header" style={{ flex: 1, textAlign: "center" }}>
							Novo agente
						</Text>
						<View style={{ width: layout.touchTarget }} />
					</View>

					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: spacing.md,
							backgroundColor: colors.surface,
							borderRadius: radius.inner,
							padding: spacing.md,
						}}
					>
						<OrbitaAvatar size={28} />
						<Text variant="body" style={{ flex: 1 }}>
							Diga em uma frase o que ele deve fazer. Eu cuido do resto.
						</Text>
					</View>

					<TextField
						multiline
						autoFocus
						accessibilityLabel="O que o agente deve fazer"
						placeholder="Ex.: me avisa quando eu gastar mais de R$ 200 em bar no fim de semana"
						value={draft.instructions}
						maxLength={1000}
						onChangeText={(instructions) => {
							setError(null);
							setDraft({ ...draft, instructions });
						}}
					/>

					{hasText ? null : (
						<View style={{ gap: spacing.sm }}>
							<Text variant="caption" tone="secondary">
								Ou comece por um destes
							</Text>
							{CREATE_EXAMPLES.map((example) => (
								<Pressable
									key={example}
									accessibilityRole="button"
									accessibilityLabel={example}
									onPress={() => setDraft({ ...draft, instructions: example })}
									style={({ pressed }) => ({
										alignSelf: "flex-start",
										minHeight: layout.touchTarget,
										justifyContent: "center",
										// Vertical: quando o exemplo quebra em duas linhas, o texto não encosta na borda.
										paddingVertical: spacing.md,
										paddingHorizontal: spacing.lg,
										borderRadius: radius.pill,
										borderWidth: 1,
										borderColor: colors.border,
										backgroundColor: colors.surface,
										opacity: pressed ? 0.8 : 1,
									})}
								>
									<Text variant="body">{example}</Text>
								</Pressable>
							))}
						</View>
					)}

					{hasText ? (
						<View
							style={{
								backgroundColor: colors.surface,
								borderRadius: radius.card,
								padding: spacing.xl,
								gap: spacing.lg,
							}}
						>
							<Text variant="caption" tone="secondary">
								Assim ficou
							</Text>
							<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
								<View
									style={{
										width: 52,
										height: 52,
										borderRadius: radius.inner,
										backgroundColor: tokens.tint,
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<AgentAvatar visual="custom" size={34} name="Agente novo" />
								</View>
								<View style={{ flex: 1 }}>
									<Text variant="bodyStrong" numberOfLines={1}>
										{draftName(draft) || "Sem nome"}
									</Text>
									<Text variant="caption" tone="secondary">
										Novo agente · você pode renomear
									</Text>
								</View>
							</View>
							<PreviewRow label="Lê" value={toolsSummary(draft.tools)} />
							<PreviewRow label="Quando" value={scheduleLabel(draft.schedule)} />
							<PreviewRow label="Como" value="Aviso no app e conversa" />
							<Text variant="caption" tone="tertiary">
								Ele só consulta os seus dados. Quem grava ou muda algo é você, no app.
							</Text>
						</View>
					) : null}

					{error ? (
						<View accessibilityRole="alert" accessibilityLiveRegion="polite">
							<Text variant="caption" tone="secondary">
								{error}
							</Text>
						</View>
					) : null}

					<View style={{ flexDirection: "row", gap: spacing.md }}>
						<Button
							label="Ajustar"
							variant="secondary"
							disabled={!hasText}
							style={{ flex: 1 }}
							onPress={() => setAdjusting(true)}
						/>
						<Button
							label="Criar agente"
							loading={create.isPending}
							disabled={!check.ok}
							style={{ flex: 1 }}
							onPress={() => void submit()}
						/>
					</View>
				</ScrollView>
			</KeyboardAvoidingView>

			<AdjustSheet
				visible={adjusting}
				draft={draft}
				onChange={setDraft}
				onClose={() => setAdjusting(false)}
			/>
		</Screen>
	);
}

/** Gaveta "Ajustar": nome, o que o agente lê e a agenda. */
function AdjustSheet({
	visible,
	draft,
	onChange,
	onClose,
}: {
	visible: boolean;
	draft: CreateDraft;
	onChange: (draft: CreateDraft) => void;
	onClose: () => void;
}) {
	const toggleTool = (name: string) => {
		const has = draft.tools.includes(name);
		onChange({ ...draft, tools: has ? draft.tools.filter((t) => t !== name) : [...draft.tools, name] });
	};
	return (
		<Sheet visible={visible} title="Ajustar" onClose={onClose}>
			<View style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
				<View style={{ gap: spacing.xs }}>
					<Text variant="caption" tone="secondary">
						Nome
					</Text>
					<TextField
						accessibilityLabel="Nome do agente"
						value={draft.name ?? draftName(draft)}
						maxLength={AGENT_NAME_MAX}
						onChangeText={(name) => onChange({ ...draft, name })}
					/>
				</View>
				<View style={{ gap: spacing.xs }}>
					<Text variant="caption" tone="secondary">
						O que ele pode ler
					</Text>
					<SheetGroup gap={false}>
						{AGENT_TOOL_OPTIONS.map((tool) => (
							<SheetRow
								key={tool.name}
								label={tool.label}
								selected={draft.tools.includes(tool.name)}
								onPress={() => toggleTool(tool.name)}
							/>
						))}
					</SheetGroup>
				</View>
				<ScheduleFields schedule={draft.schedule} onChange={(schedule) => onChange({ ...draft, schedule })} />
				<Button label="Pronto" onPress={onClose} />
			</View>
		</Sheet>
	);
}
