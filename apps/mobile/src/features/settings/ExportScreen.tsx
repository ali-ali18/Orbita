import { EXPORT_DATASET_LABELS, type ExportDataset, type ExportFormat } from "@orbita/shared";
import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { errorMessage } from "../../lib/loadable.ts";
import { Button, Chip, Text, TextField } from "../../ui/index.ts";
import { maskBrDate } from "../transactions/new-transaction-model.ts";
import {
	DATASET_ORDER,
	datasetsForFormat,
	EXPORT_DONE,
	exportParams,
	PERIOD_LABELS,
	type PeriodChoice,
	periodRange,
	toggleDataset,
} from "./export-model.ts";
import { useExportData } from "./export-queries.ts";
import { ChoiceRow, Note, SubScreen } from "./parts.tsx";
import { SettingsRow, SettingsSection, StaticSwitch } from "./SettingsRows.tsx";

const PERIODS: PeriodChoice[] = ["month", "year", "all", "custom"];

/**
 * Tela "Exportar tudo" (Figma 44:888). CSV (uma planilha por tipo de dado) ou JSON (tudo junto, com dinheiro em
 * centavos). O servidor monta o arquivo; aqui só se escolhe o que levar. OFX, comprovantes e conversas com agentes
 * aparecem esmaecidos: ainda não existem.
 */
export function ExportScreen() {
	const { today } = useClock();
	const exporter = useExportData();
	const [period, setPeriod] = useState<PeriodChoice>("all");
	const [custom, setCustom] = useState({ from: "", to: "" });
	const [format, setFormat] = useState<ExportFormat>("csv");
	const [include, setInclude] = useState<ExportDataset[]>(["transactions"]);
	const [message, setMessage] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	const reset = () => {
		setMessage(null);
		setDone(false);
	};

	const chooseFormat = (next: ExportFormat) => {
		reset();
		setFormat(next);
		setInclude((current) => datasetsForFormat(next, current));
	};

	const submit = () => {
		if (exporter.isPending) return;
		reset();
		const range = periodRange(period, today, custom);
		if (!range.ok) {
			setMessage(range.message);
			return;
		}
		const first = include[0] ?? "transactions";
		exporter.mutate(
			{
				format,
				params: exportParams({ format, include, range: range.range }),
				fallbackName: `orbita-${first}-${today}.${format}`,
			},
			{
				onSuccess: (outcome) =>
					outcome === "unavailable"
						? setMessage("Este aparelho não consegue compartilhar arquivos.")
						: setDone(true),
				onError: (error) => setMessage(errorMessage(error)),
			},
		);
	};

	const withTransactions = include.includes("transactions");

	return (
		<SubScreen
			title="Exportar tudo"
			subtitle="Seus dados são seus. Leve para uma planilha ou para outro app."
		>
			<View style={{ gap: spacing.sm }}>
				<Text variant="caption" tone="secondary" accessibilityRole="header">
					Período
				</Text>
				<View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.sm }}>
					{PERIODS.map((p) => (
						<Chip
							key={p}
							label={PERIOD_LABELS[p]}
							active={period === p}
							onPress={() => {
								reset();
								setPeriod(p);
							}}
						/>
					))}
				</View>
				{period === "custom" ? (
					<View style={{ flexDirection: "row", gap: spacing.md }}>
						<TextField
							style={{ flex: 1 }}
							value={custom.from}
							onChangeText={(text) => setCustom({ ...custom, from: maskBrDate(text) })}
							placeholder="De DD/MM/AAAA"
							accessibilityLabel="Data inicial"
							keyboardType="number-pad"
						/>
						<TextField
							style={{ flex: 1 }}
							value={custom.to}
							onChangeText={(text) => setCustom({ ...custom, to: maskBrDate(text) })}
							placeholder="Até DD/MM/AAAA"
							accessibilityLabel="Data final"
							keyboardType="number-pad"
						/>
					</View>
				) : null}
				{!withTransactions ? (
					<Text variant="caption" tone="tertiary">
						O período vale só para lançamentos.
					</Text>
				) : null}
			</View>

			<SettingsSection title="Formato">
				<ChoiceRow
					title="CSV"
					caption="Abre no Excel e no Google Planilhas"
					selected={format === "csv"}
					onPress={() => chooseFormat("csv")}
				/>
				<ChoiceRow
					title="JSON"
					caption="Completo: valores em centavos, ids e tudo que você escolher"
					selected={format === "json"}
					onPress={() => chooseFormat("json")}
				/>
				<ChoiceRow title="OFX" caption="Para importar em outro app de finanças" selected={false} last />
			</SettingsSection>

			<SettingsSection title="Incluir">
				{DATASET_ORDER.map((dataset) => (
					<SettingsRow
						key={dataset}
						title={EXPORT_DATASET_LABELS[dataset]}
						chevron={false}
						toggled={include.includes(dataset)}
						onPress={() => {
							reset();
							setInclude(toggleDataset(format, include, dataset));
						}}
						trailing={<StaticSwitch on={include.includes(dataset)} />}
					/>
				))}
				<SettingsRow
					title="Comprovantes (arquivos)"
					chevron={false}
					soon
					trailing={<StaticSwitch on={false} />}
				/>
				<SettingsRow
					last
					title="Conversas com os agentes"
					chevron={false}
					soon
					trailing={<StaticSwitch on={false} />}
				/>
			</SettingsSection>
			{format === "csv" ? (
				<Text variant="caption" tone="tertiary">
					No CSV vai um tipo de dado por arquivo. Para levar tudo junto, use JSON.
				</Text>
			) : null}

			{message ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
					{message}
				</Text>
			) : null}
			{done ? (
				<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
					{EXPORT_DONE}
				</Text>
			) : null}
			<Button label="Exportar" loading={exporter.isPending} onPress={submit} />
			<Note
				icon="cadeado"
				text={`O arquivo tem seus dados financeiros em texto aberto. Guarde e compartilhe com cuidado. Chaves e códigos do servidor nunca entram.`}
			/>
		</SubScreen>
	);
}
