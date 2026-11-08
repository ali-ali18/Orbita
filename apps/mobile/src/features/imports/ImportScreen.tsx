import type { CsvMappingBody, ImportNeedsMapping, ImportPreviewReady } from "@orbita/shared";
import { colors, layout, radius, spacing } from "@orbita/tokens";
import { type DocumentPickerAsset, getDocumentAsync } from "expo-document-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { money } from "../../lib/format.ts";
import { errorMessage } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	Button,
	Chip,
	ErrorState,
	Icon,
	IconButton,
	Screen,
	Segmented,
	Sheet,
	SheetGroup,
	SheetRow,
	Text,
	TOP_FADE,
} from "../../ui/index.ts";
import { useAccounts, useCards } from "../summary/queries.ts";
import {
	buildMapping,
	fileProblem,
	type ImportTarget,
	importedMessage,
	initialChoice,
	type MappingChoice,
	periodLabel,
	previewHeadline,
	previewNotes,
} from "./import-model.ts";
import { type ImportRequest, usePreviewImport, useRunImport } from "./queries.ts";

const PICKER_TYPES = [
	"text/csv",
	"text/comma-separated-values",
	"text/plain",
	"application/pdf",
	"application/x-ofx",
	"application/octet-stream",
	"*/*",
];

/** Bloco `surface` com cantos do grupo (o cartão de resumo e de arquivo). */
function Panel({ children }: { children: React.ReactNode }) {
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.sm,
			}}
		>
			{children}
		</View>
	);
}

function Figure({ label, value }: { label: string; value: string }) {
	return (
		<View style={{ flex: 1, gap: 2 }}>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
			<Text variant="bodyStrong">{value}</Text>
		</View>
	);
}

/**
 * Importar extrato: escolher o arquivo (CSV, OFX ou PDF) -> escolher a conta ou o cartão -> ver o resumo que o
 * servidor leu (quantos, período, entradas e saídas) -> se o CSV for ambíguo, dizer qual coluna é qual -> importar.
 * Os lançamentos entram como pendentes e a conferência item a item é feita na tela Para revisar.
 */
export function ImportScreen() {
	const router = useRouter();
	const { hidden } = usePrivacy();
	const accounts = useAccounts();
	const cards = useCards();
	const preview = usePreviewImport();
	const run = useRunImport();

	const [file, setFile] = useState<DocumentPickerAsset | null>(null);
	const [target, setTarget] = useState<ImportTarget | null>(null);
	const [mapping, setMapping] = useState<CsvMappingBody | null>(null);
	const [invertSign, setInvertSign] = useState(false);
	const [includeDupes, setIncludeDupes] = useState(false);
	const [pickingTarget, setPickingTarget] = useState(false);
	const [choice, setChoice] = useState<MappingChoice | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
	const accountRows = accounts.data?.accounts.filter((a) => !a.archivedAt) ?? [];
	const cardRows = cards.data?.cards.filter((c) => !c.archivedAt) ?? [];
	const targetName =
		target?.kind === "account"
			? accountRows.find((a) => a.id === target.id)?.name
			: cardRows.find((c) => c.id === target?.id)?.name;

	const request = (over: Partial<ImportRequest> = {}): ImportRequest | null =>
		file && target
			? {
					file,
					target,
					mapping,
					invertSign,
					includePossibleDuplicates: includeDupes,
					...over,
				}
			: null;

	const runPreview = (over: Partial<ImportRequest> = {}) => {
		const req = request(over);
		if (!req) return;
		setMessage(null);
		preview.mutate(req, { onError: (e) => setMessage(errorMessage(e)) });
	};

	const pickFile = async () => {
		setMessage(null);
		try {
			const result = await getDocumentAsync({
				type: PICKER_TYPES,
				copyToCacheDirectory: true,
				multiple: false,
			});
			const asset = result.canceled ? undefined : result.assets[0];
			if (!asset) return;
			const problem = fileProblem(asset);
			if (problem) {
				setMessage(problem);
				return;
			}
			setFile(asset);
			setMapping(null);
			setChoice(null);
			setInvertSign(false);
			setIncludeDupes(false);
			setDone(null);
			preview.reset();
			if (target) preview.mutate({ file: asset, target }, { onError: (e) => setMessage(errorMessage(e)) });
		} catch {
			setMessage("Não consegui abrir o seletor de arquivos.");
		}
	};

	const chooseTarget = (next: ImportTarget) => {
		setTarget(next);
		setPickingTarget(false);
		setMapping(null);
		if (file) {
			preview.mutate({ file, target: next }, { onError: (e) => setMessage(errorMessage(e)) });
		}
	};

	const need: ImportNeedsMapping | null = preview.data?.status === "needs_mapping" ? preview.data : null;
	const ready: ImportPreviewReady | null = preview.data?.status === "ok" ? preview.data : null;

	const confirm = () => {
		const req = request();
		if (!req) return;
		setMessage(null);
		run.mutate(req, {
			onSuccess: (r) => {
				if (r.status === "needs_mapping") {
					setMessage("Preciso saber quais colunas usar antes de importar.");
					return;
				}
				setDone(
					r.status === "already_imported"
						? "Este arquivo já foi importado para este destino. Nada mudou."
						: importedMessage(r.summary),
				);
			},
			onError: (e) => setMessage(errorMessage(e)),
		});
	};

	const nothingToImport = ready !== null && ready.toCreate === 0;
	const busy = preview.isPending || run.isPending;

	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.lg,
				}}
			>
				<View style={{ height: layout.touchTarget, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton icon="voltar" label="Voltar" onPress={back} />
				</View>
				<View style={{ gap: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						Importar extrato
					</Text>
					<Text variant="body" tone="secondary">
						Escolha o arquivo do banco (CSV, OFX ou PDF). Antes de salvar, você vê o que foi lido. Nada entra
						nos seus números até você confirmar em Para revisar.
					</Text>
				</View>

				{done ? (
					<Panel>
						<Text variant="bodyStrong" accessibilityRole="alert">
							{done}
						</Text>
						<View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
							<Button label="Ir para Para revisar" onPress={() => router.replace("/revisao")} />
							<Button
								label="Importar outro arquivo"
								variant="secondary"
								onPress={() => {
									setDone(null);
									setFile(null);
									preview.reset();
									run.reset();
								}}
							/>
						</View>
					</Panel>
				) : (
					<>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={file ? `Arquivo ${file.name}. Trocar arquivo` : "Escolher arquivo"}
							onPress={pickFile}
							style={({ pressed }) => ({
								flexDirection: "row",
								alignItems: "center",
								gap: spacing.md,
								minHeight: layout.touchTarget + spacing.lg,
								paddingHorizontal: spacing.lg,
								backgroundColor: colors.surface,
								borderRadius: radius.group,
								opacity: pressed ? 0.8 : 1,
							})}
						>
							<Icon name="baixar" size={20} />
							<View style={{ flex: 1 }}>
								<Text variant="body" numberOfLines={1}>
									{file ? file.name : "Escolher arquivo"}
								</Text>
								<Text variant="caption" tone="secondary">
									{file ? "Toque para trocar" : "CSV, OFX ou PDF, até 5 MB"}
								</Text>
							</View>
							<Icon name="seta-direita" size={16} />
						</Pressable>

						<Pressable
							accessibilityRole="button"
							accessibilityLabel={targetName ? `Destino ${targetName}. Trocar` : "Escolher conta ou cartão"}
							onPress={() => setPickingTarget(true)}
							style={({ pressed }) => ({
								flexDirection: "row",
								alignItems: "center",
								gap: spacing.md,
								minHeight: layout.touchTarget + spacing.lg,
								paddingHorizontal: spacing.lg,
								backgroundColor: colors.surface,
								borderRadius: radius.group,
								opacity: pressed ? 0.8 : 1,
							})}
						>
							<Icon name="banco" size={20} />
							<View style={{ flex: 1 }}>
								<Text variant="body" numberOfLines={1}>
									{targetName ?? "Conta ou cartão"}
								</Text>
								<Text variant="caption" tone="secondary">
									{targetName ? "Para onde vão os lançamentos" : "Escolha para onde vão os lançamentos"}
								</Text>
							</View>
							<Icon name="seta-direita" size={16} />
						</Pressable>

						{message ? (
							preview.isError && file && target ? (
								<ErrorState message={message} onRetry={() => runPreview()} />
							) : (
								<Text variant="caption" tone="secondary" accessibilityRole="alert">
									{message}
								</Text>
							)
						) : null}

						{preview.isPending ? (
							<Text variant="body" tone="secondary" accessibilityRole="progressbar">
								Lendo o arquivo…
							</Text>
						) : null}

						{need ? (
							<Panel>
								<Text variant="bodyStrong">Quais colunas são quais?</Text>
								<Text variant="caption" tone="secondary">
									{need.reason}
								</Text>
								<Button label="Escolher colunas" compact onPress={() => setChoice(initialChoice(need))} />
							</Panel>
						) : null}

						{ready ? (
							<>
								<Panel>
									<Text variant="bodyStrong" accessibilityRole="header">
										{previewHeadline(ready)}
									</Text>
									<View style={{ flexDirection: "row", gap: spacing.md }}>
										<Figure label="Período" value={periodLabel(ready.period)} />
										<Figure label="Lançamentos" value={String(ready.toCreate)} />
									</View>
									<View style={{ flexDirection: "row", gap: spacing.md }}>
										<Figure label="Entradas" value={money(ready.inCents, hidden)} />
										<Figure label="Saídas" value={money(ready.outCents, hidden)} />
									</View>
									{ready.alreadyImported ? (
										<Text variant="caption" tone="secondary">
											Este arquivo já foi importado para este destino.
										</Text>
									) : null}
									{previewNotes(ready).map((note) => (
										<Text key={note} variant="caption" tone="secondary">
											{note}
										</Text>
									))}
								</Panel>

								{ready.possibleDuplicates > 0 ? (
									<View style={{ flexDirection: "row" }}>
										<Chip
											label={
												includeDupes
													? "Incluindo os que parecem repetidos"
													: "Importar também os que parecem repetidos"
											}
											active={includeDupes}
											onPress={() => {
												setIncludeDupes(!includeDupes);
												runPreview({ includePossibleDuplicates: !includeDupes });
											}}
										/>
									</View>
								) : null}
								<View style={{ flexDirection: "row" }}>
									<Chip
										label={invertSign ? "Entradas e saídas trocadas" : "Trocar entradas e saídas"}
										active={invertSign}
										onPress={() => {
											setInvertSign(!invertSign);
											runPreview({ invertSign: !invertSign });
										}}
									/>
								</View>

								{ready.items.length > 0 ? (
									<View
										style={{
											backgroundColor: colors.surface,
											borderRadius: radius.group,
											overflow: "hidden",
										}}
									>
										{ready.items.slice(0, 8).map((item, i) => (
											<View
												// biome-ignore lint/suspicious/noArrayIndexKey: amostra estática do resumo
												key={i}
												style={{
													flexDirection: "row",
													alignItems: "center",
													gap: spacing.md,
													paddingHorizontal: spacing.lg,
													paddingVertical: spacing.md,
													borderBottomWidth: i === Math.min(ready.items.length, 8) - 1 ? 0 : 1,
													borderBottomColor: colors.border,
													opacity: item.status === "new" ? 1 : 0.5,
												}}
											>
												<View style={{ flex: 1 }}>
													<Text variant="body" numberOfLines={1}>
														{item.description}
													</Text>
													<Text variant="caption" tone="secondary">
														{item.status === "duplicate"
															? "Já existe"
															: item.status === "possible_duplicate"
																? "Parece repetido"
																: periodLabel({ from: item.date, to: item.date })}
													</Text>
												</View>
												<Text variant="body" tone={item.amountCents > 0 ? "positive" : "primary"}>
													{money(item.amountCents, hidden, { sign: "auto" })}
												</Text>
											</View>
										))}
									</View>
								) : null}
								{ready.items.length > 8 ? (
									<Text variant="caption" tone="secondary">
										{`e mais ${ready.items.length - 8}${ready.total > ready.items.length ? " ou mais" : ""}. Você confere cada um em Para revisar.`}
									</Text>
								) : null}

								{ready.unrecognized.length > 0 ? (
									<Panel>
										<Text variant="bodyStrong">Não entendi estas linhas</Text>
										<Text variant="caption" tone="secondary">
											Ficam de fora. Confira no banco se faltou algo.
										</Text>
										{ready.unrecognized.slice(0, 5).map((line) => (
											<Text key={line.line} variant="caption" numberOfLines={2}>
												{`Linha ${line.line}: ${line.text} (${line.reason})`}
											</Text>
										))}
										{ready.unrecognizedTotal > 5 ? (
											<Text variant="caption" tone="secondary">
												{`e mais ${ready.unrecognizedTotal - 5}`}
											</Text>
										) : null}
									</Panel>
								) : null}

								<Button
									label={nothingToImport ? "Nada para importar" : `Importar ${ready.toCreate}`}
									disabled={nothingToImport || busy}
									loading={run.isPending}
									onPress={confirm}
								/>
							</>
						) : null}
					</>
				)}
			</ScrollView>

			<Sheet
				visible={pickingTarget}
				title="Para onde vão os lançamentos?"
				onClose={() => setPickingTarget(false)}
			>
				{accountRows.length > 0 ? (
					<SheetGroup>
						{accountRows.map((a) => (
							<SheetRow
								key={a.id}
								icon="banco"
								label={a.name}
								selected={target?.kind === "account" && target.id === a.id}
								role="radio"
								onPress={() => chooseTarget({ kind: "account", id: a.id })}
							/>
						))}
					</SheetGroup>
				) : null}
				{cardRows.length > 0 ? (
					<SheetGroup>
						{cardRows.map((c) => (
							<SheetRow
								key={c.id}
								icon="cartao"
								label={c.name}
								caption="Fatura de cartão"
								selected={target?.kind === "card" && target.id === c.id}
								role="radio"
								onPress={() => chooseTarget({ kind: "card", id: c.id })}
							/>
						))}
					</SheetGroup>
				) : null}
				{accountRows.length === 0 && cardRows.length === 0 ? (
					<Text variant="body" tone="secondary">
						Cadastre uma conta ou um cartão em Bancos e cartões primeiro.
					</Text>
				) : null}
			</Sheet>

			<Sheet
				visible={choice !== null && need !== null}
				title="Quais colunas são quais?"
				onClose={() => setChoice(null)}
			>
				{choice && need ? (
					<MappingForm
						need={need}
						choice={choice}
						onChange={setChoice}
						onApply={(built) => {
							setMapping(built);
							setChoice(null);
							runPreview({ mapping: built });
						}}
					/>
				) : null}
			</Sheet>
		</Screen>
	);
}

function ColumnGroup({
	title,
	columns,
	value,
	onPick,
}: {
	title: string;
	columns: readonly string[];
	value: number | null;
	onPick: (index: number) => void;
}) {
	return (
		<View style={{ gap: spacing.sm }}>
			<Text variant="caption" tone="secondary">
				{title}
			</Text>
			<SheetGroup>
				{columns.map((name, i) => (
					<SheetRow
						// biome-ignore lint/suspicious/noArrayIndexKey: o nome da coluna pode repetir; a posição é a identidade
						key={i}
						icon="etiqueta"
						label={name}
						selected={value === i}
						role="radio"
						onPress={() => onPick(i)}
					/>
				))}
			</SheetGroup>
		</View>
	);
}

function MappingForm({
	need,
	choice,
	onChange,
	onApply,
}: {
	need: ImportNeedsMapping;
	choice: MappingChoice;
	onChange: (next: MappingChoice) => void;
	onApply: (built: NonNullable<ReturnType<typeof buildMapping>>) => void;
}) {
	const built = buildMapping(need, choice);
	return (
		<View style={{ gap: spacing.md }}>
			{need.sample[0] ? (
				<Text variant="caption" tone="secondary" numberOfLines={3}>
					{`Exemplo de linha: ${need.sample[0].join(" | ")}`}
				</Text>
			) : null}
			<ColumnGroup
				title="Data"
				columns={need.columns}
				value={choice.date}
				onPick={(date) => onChange({ ...choice, date })}
			/>
			<ColumnGroup
				title="Descrição"
				columns={need.columns}
				value={choice.description}
				onPick={(description) => onChange({ ...choice, description })}
			/>
			<Segmented
				options={[
					{ id: "amount", label: "Uma coluna de valor" },
					{ id: "split", label: "Saída e entrada" },
				]}
				value={choice.mode}
				onChange={(mode) => onChange({ ...choice, mode })}
			/>
			{choice.mode === "amount" ? (
				<ColumnGroup
					title="Valor (negativo = saída)"
					columns={need.columns}
					value={choice.amount}
					onPick={(amount) => onChange({ ...choice, amount })}
				/>
			) : (
				<>
					<ColumnGroup
						title="Saída"
						columns={need.columns}
						value={choice.debit}
						onPick={(debit) => onChange({ ...choice, debit })}
					/>
					<ColumnGroup
						title="Entrada"
						columns={need.columns}
						value={choice.credit}
						onPick={(credit) => onChange({ ...choice, credit })}
					/>
				</>
			)}
			<Button label="Usar estas colunas" disabled={built === null} onPress={() => built && onApply(built)} />
		</View>
	);
}
