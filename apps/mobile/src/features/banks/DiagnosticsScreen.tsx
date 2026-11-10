import {
	diagAccountTitle,
	diagConnectionTitle,
	diagInvestmentsTitle,
	formatDiagAccount,
	formatDiagConnectionHead,
	formatDiagInvestments,
	formatPluggyDiagnostics,
	type PluggyDiagnosticsResponse,
} from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Share, View } from "react-native";
import { toLoadable } from "../../lib/loadable.ts";
import { APP_UPDATE_TITLE } from "../../lib/update-diagnostics.ts";
import { Button, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { SubScreen } from "../settings/parts.tsx";
import { usePluggyDiagnostics } from "./queries.ts";
import { useAppUpdate } from "./use-app-update.ts";

function Block({ title, body }: { title: string; body: string }) {
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.sm,
			}}
		>
			<Text variant="bodyStrong" accessibilityRole="header">
				{title}
			</Text>
			{/* Selecionável: o dono pode copiar só este trecho. */}
			<Text variant="caption" tone="secondary" selectable>
				{body}
			</Text>
		</View>
	);
}

function Report({ data }: { data: PluggyDiagnosticsResponse }) {
	if (data.connections.length === 0) {
		return (
			<Text variant="body" tone="secondary">
				Nenhuma conexão cadastrada ainda.
			</Text>
		);
	}
	return (
		<>
			{data.connections.map((c) => (
				<View key={c.itemIdStart} style={{ gap: spacing.md }}>
					<Block title={diagConnectionTitle(c)} body={formatDiagConnectionHead(c)} />
					{c.accounts.map((a) => (
						<Block key={a.idStart} title={diagAccountTitle(a)} body={formatDiagAccount(a)} />
					))}
					{/* Servidor antigo não manda a seção: o texto diz "não consultado". */}
					<Block title={diagInvestmentsTitle(c)} body={formatDiagInvestments(c.investments)} />
				</View>
			))}
		</>
	);
}

/**
 * "Atualização do app": APK, JavaScript em uso, runtimeVersion, o que o servidor oferece e a última checagem.
 * Aparece sempre, mesmo sem chaves do Pluggy: é aqui que o dono vê por que uma atualização chegou ou não.
 */
function AppUpdate({ update }: { update: ReturnType<typeof useAppUpdate> }) {
	return (
		<View style={{ gap: spacing.md }}>
			<Block title={APP_UPDATE_TITLE} body={update.text} />
			<Button
				label={update.checking ? "Procurando…" : "Procurar atualização agora"}
				variant="secondary"
				disabled={update.checking}
				onPress={() => void update.checkNow()}
			/>
			{update.pending ? (
				<Button label="Reiniciar o app para aplicar" onPress={() => void update.applyNow()} />
			) : null}
			{update.message ? (
				<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
					{update.message}
				</Text>
			) : null}
		</View>
	);
}

/**
 * "Diagnóstico da conexão": o que o Pluggy devolve agora (consulta ao vivo, só leitura), já sem CPF/CNPJ nem número
 * de conta ou cartão, mais o bloco "Atualização do app". O texto é selecionável e o botão abre o menu do sistema
 * (Copiar, WhatsApp…) com o relatório inteiro.
 */
export function DiagnosticsScreen() {
	const q = usePluggyDiagnostics();
	const view = toLoadable(q);
	const update = useAppUpdate();
	const [message, setMessage] = useState<string | null>(null);

	const share = async (data: PluggyDiagnosticsResponse | null) => {
		setMessage(null);
		try {
			const parts = [`${APP_UPDATE_TITLE}\n${update.text}`, ...(data ? [formatPluggyDiagnostics(data)] : [])];
			await Share.share({ message: parts.join("\n\n") });
		} catch {
			setMessage("Não deu para abrir o menu de compartilhar.");
		}
	};

	return (
		<SubScreen
			title="Diagnóstico da conexão"
			subtitle="O que o Pluggy devolve agora, sem CPF nem números completos, e a situação da atualização do app. Dá para tirar print ou copiar o texto."
		>
			<Button
				label="Copiar como texto"
				onPress={() => void share(view.phase === "ready" ? view.data : null)}
			/>
			{message ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert">
					{message}
				</Text>
			) : null}
			<AppUpdate update={update} />
			{view.phase === "loading" ? (
				<>
					<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
						Consultando o Pluggy ao vivo. Pode levar até um minuto.
					</Text>
					<Skeleton height={spacing.xxxl * 3} />
					<Skeleton height={spacing.xxxl * 4} />
				</>
			) : null}
			{view.phase === "error" ? <ErrorState message={view.message} onRetry={view.retry} /> : null}
			{view.phase === "ready" ? (
				<>
					<Report data={view.data} />
					<Button
						label={q.isFetching ? "Consultando…" : "Consultar de novo"}
						variant="secondary"
						disabled={q.isFetching}
						onPress={() => void q.refetch()}
					/>
				</>
			) : null}
		</SubScreen>
	);
}
