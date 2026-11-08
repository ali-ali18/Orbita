import type { LocalDate } from "@orbita/core";
import { colors, radius, spacing } from "@orbita/tokens";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { BankLogo, Button, Sheet, SheetGroup, SheetRow, Text, TextField } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { categoryDot } from "../transactions/new-transaction-model.ts";
import {
	type ActivityFilters,
	applyLabel,
	EMPTY_FILTERS,
	hasActiveFilters,
	hasErrors,
	maskBrDate,
	PERIOD_OPTIONS,
	type PeriodPreset,
	SOURCE_OPTIONS,
	STATUS_OPTIONS,
	type StatusId,
	TYPE_OPTIONS,
	toggleItem,
	toQueryParams,
	validateFilters,
} from "./filters-model.ts";
import { OptionChip } from "./OptionChip.tsx";
import { useFilterCount } from "./queries.ts";

export interface FilterSheetSources {
	accounts: readonly { id: string; name: string; bankCode?: string | null }[];
	cards: readonly { id: string; name: string; last4: string | null; bankCode?: string | null }[];
	categories: readonly { id: string; name: string; slug: string; chartSlot: number | null }[];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<View style={{ gap: 10, paddingBottom: spacing.xl }}>
			<Text variant="caption" tone="secondary" accessibilityRole="header">
				{title}
			</Text>
			{children}
		</View>
	);
}

const Wrap = ({ children }: { children: ReactNode }) => (
	<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{children}</View>
);

/**
 * Gaveta "Filtros" de Atividades (Figma 51:918). Edita uma cópia (`draft`); só "Ver N lançamentos" aplica. O N vem do
 * servidor (`/v1/transactions/count`) com o rascunho, então o botão já diz quantos lançamentos o filtro acharia.
 */
export function FilterSheet({
	visible,
	onClose,
	applied,
	onApply,
	sources,
	today,
}: {
	visible: boolean;
	onClose: () => void;
	applied: ActivityFilters;
	onApply: (next: ActivityFilters) => void;
	sources: FilterSheetSources;
	today: LocalDate;
}) {
	const [draft, setDraft] = useState(applied);
	// Cada abertura recomeça do que está aplicado (descartar = fechar sem aplicar).
	useEffect(() => {
		if (visible) setDraft(applied);
	}, [visible, applied]);

	const errors = useMemo(() => validateFilters(draft), [draft]);
	const invalid = hasErrors(errors);
	const params = useMemo(() => toQueryParams(draft, today), [draft, today]);
	const count = useFilterCount(params, visible && !invalid);
	const total = invalid || count.data === undefined ? null : count.data.count;

	const patch = (next: Partial<ActivityFilters>) => setDraft((d) => ({ ...d, ...next }));
	const pickPeriod = (id: PeriodPreset) => patch({ period: draft.period === id ? null : id });
	const pickStatus = (id: StatusId | null) => patch({ statuses: id ? [id] : [] });

	return (
		<Sheet visible={visible} onClose={onClose}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					paddingBottom: spacing.lg,
				}}
			>
				<Text variant="bodyStrong" accessibilityRole="header">
					Filtros
				</Text>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Limpar filtros"
					accessibilityState={{ disabled: !hasActiveFilters(draft) }}
					disabled={!hasActiveFilters(draft)}
					onPress={() => setDraft(EMPTY_FILTERS)}
					hitSlop={12}
				>
					<Text variant="body" tone={hasActiveFilters(draft) ? "primary" : "tertiary"}>
						Limpar
					</Text>
				</Pressable>
			</View>

			<Section title="Período">
				<Wrap>
					{PERIOD_OPTIONS.map((o) => (
						<OptionChip
							key={o.id}
							label={o.label}
							selected={draft.period === o.id}
							onPress={() => pickPeriod(o.id)}
						/>
					))}
				</Wrap>
				{draft.period === "custom" ? (
					<View style={{ flexDirection: "row", gap: spacing.sm }}>
						<DateField
							label="De"
							value={draft.from}
							error={errors.from}
							onChange={(from) => patch({ from })}
						/>
						<DateField label="Até" value={draft.to} error={errors.to} onChange={(to) => patch({ to })} />
					</View>
				) : null}
			</Section>

			<Section title="Tipo">
				<Wrap>
					{TYPE_OPTIONS.map((o) => (
						<OptionChip
							key={o.id}
							label={o.label}
							selected={draft.types.includes(o.id)}
							onPress={() => patch({ types: toggleItem(draft.types, o.id) })}
						/>
					))}
				</Wrap>
			</Section>

			{sources.accounts.length + sources.cards.length > 0 ? (
				<Section title="Contas e cartões">
					<Wrap>
						{sources.accounts.map((a) => (
							<OptionChip
								key={a.id}
								label={a.name}
								selected={draft.accountIds.includes(a.id)}
								onPress={() => patch({ accountIds: toggleItem(draft.accountIds, a.id) })}
								leading={<BankLogo {...bankBadge(a)} size={20} />}
							/>
						))}
						{sources.cards.map((c) => (
							<OptionChip
								key={c.id}
								label={c.last4 ? `${c.name} ••••${c.last4}` : c.name}
								selected={draft.cardIds.includes(c.id)}
								onPress={() => patch({ cardIds: toggleItem(draft.cardIds, c.id) })}
								leading={<BankLogo {...bankBadge(c)} size={20} />}
							/>
						))}
					</Wrap>
				</Section>
			) : null}

			{sources.categories.length > 0 ? (
				<Section title="Categorias">
					<Wrap>
						{sources.categories.map((c) => (
							<OptionChip
								key={c.id}
								label={c.name}
								selected={draft.categoryIds.includes(c.id)}
								onPress={() => patch({ categoryIds: toggleItem(draft.categoryIds, c.id) })}
								leading={
									<View
										style={{
											width: 8,
											height: 8,
											marginLeft: 6,
											borderRadius: radius.pill,
											backgroundColor: categoryDot(c.chartSlot, c.slug),
										}}
									/>
								}
							/>
						))}
					</Wrap>
				</Section>
			) : null}

			<Section title="Valor">
				<View style={{ flexDirection: "row", gap: spacing.sm }}>
					<MoneyField
						label="Mínimo"
						value={draft.min}
						error={errors.min}
						onChange={(min) => patch({ min })}
					/>
					<MoneyField
						label="Máximo"
						value={draft.max}
						error={errors.max}
						onChange={(max) => patch({ max })}
					/>
				</View>
			</Section>

			<Section title="Origem">
				<Wrap>
					{SOURCE_OPTIONS.map((o) => (
						<OptionChip
							key={o.id}
							label={o.label}
							selected={draft.sources.includes(o.id)}
							onPress={() => patch({ sources: toggleItem(draft.sources, o.id) })}
						/>
					))}
				</Wrap>
			</Section>

			<Section title="Situação">
				<SheetGroup gap={false}>
					<SheetRow label="Todas" selected={draft.statuses.length === 0} onPress={() => pickStatus(null)} />
					{STATUS_OPTIONS.map((o) => (
						<SheetRow
							key={o.id}
							label={o.label}
							selected={draft.statuses.length === 1 && draft.statuses[0] === o.id}
							onPress={() => pickStatus(o.id)}
						/>
					))}
				</SheetGroup>
			</Section>

			<View style={{ paddingTop: spacing.xs, paddingBottom: spacing.sm }}>
				<Button
					label={applyLabel(total)}
					disabled={invalid || total === 0}
					onPress={() => {
						onApply(draft);
						onClose();
					}}
				/>
			</View>
		</Sheet>
	);
}

function Labeled({
	label,
	error,
	children,
}: {
	label: string;
	error: string | undefined;
	children: ReactNode;
}) {
	return (
		<View style={{ flex: 1, gap: spacing.xs }}>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
			{children}
			{error ? (
				<Text variant="caption" accessibilityLiveRegion="polite" style={{ color: colors.text }}>
					{error}
				</Text>
			) : null}
		</View>
	);
}

function DateField({
	label,
	value,
	error,
	onChange,
}: {
	label: string;
	value: string;
	error: string | undefined;
	onChange: (next: string) => void;
}) {
	return (
		<Labeled label={label} error={error}>
			<TextField
				value={value}
				onChangeText={(t) => onChange(maskBrDate(t))}
				placeholder="dd/mm/aaaa"
				keyboardType="number-pad"
				maxLength={10}
				accessibilityLabel={`Data ${label === "De" ? "inicial" : "final"}`}
			/>
		</Labeled>
	);
}

function MoneyField({
	label,
	value,
	error,
	onChange,
}: {
	label: string;
	value: string;
	error: string | undefined;
	onChange: (next: string) => void;
}) {
	return (
		<Labeled label={label} error={error}>
			<TextField
				value={value}
				onChangeText={onChange}
				placeholder="R$ 0,00"
				keyboardType="decimal-pad"
				maxLength={14}
				accessibilityLabel={`Valor ${label.toLowerCase()} em reais`}
			/>
		</Labeled>
	);
}
