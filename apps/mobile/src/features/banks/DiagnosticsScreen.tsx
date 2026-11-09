import {
	diagAccountTitle,
	diagConnectionTitle,
	formatDiagAccount,
	formatDiagConnectionHead,
	formatPluggyDiagnostics,
	type PluggyDiagnosticsResponse,
} from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Share, View } from "react-native";
import { toLoadable } from "../../lib/loadable.ts";
import { Button, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { SubScreen } from "../settings/parts.tsx";
import { usePluggyDiagnostics } from "./queries.ts";

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
				</View>
			))}
		</>
	);
}

/**
 * "Diagnóstico da conexão": o que o Pluggy devolve agora (consulta ao vivo, só leitura), já sem CPF/CNPJ nem número
 * de conta ou cartão. O texto é selecionável e o botão abre o menu do sistema (Copiar, WhatsApp…) com o relatório inteiro.
 */
export function DiagnosticsScreen() {
	const q = usePluggyDiagnostics();
	const view = toLoadable(q);
	const [message, setMessage] = useState<string | null>(null);

	const share = async (data: PluggyDiagnosticsResponse) => {
		setMessage(null);
		try {
			await Share.share({ message: formatPluggyDiagnostics(data) });
		} catch {
			setMessage("Não deu para abrir o menu de compartilhar.");
		}
	};

	return (
		<SubScreen
			title="Diagnóstico da conexão"
			subtitle="O que o Pluggy devolve agora, sem CPF nem números completos. Dá para tirar print ou copiar o texto."
		>
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
					<Button label="Copiar como texto" onPress={() => void share(view.data)} />
					{message ? (
						<Text variant="caption" tone="secondary" accessibilityRole="alert">
							{message}
						</Text>
					) : null}
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
