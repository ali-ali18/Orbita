import {
	HOME_WIDGETS,
	type HomeLayout,
	type HomeLayoutItem,
	moveWidget,
	setWidgetSize,
	setWidgetVisible,
} from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Button, IconButton, Segmented, Text } from "../../../ui/index.ts";

/**
 * Edição dos widgets: os que aparecem, na ordem do Início, com setas para subir e descer (sem biblioteca de
 * arrastar), tamanho e tirar; e os ocultos, com "Adicionar". Tudo acontece num rascunho: quem usa salva em "Concluir".
 */
export function WidgetEditor({
	layout,
	onChange,
}: {
	layout: HomeLayout;
	onChange: (next: HomeLayout) => void;
}) {
	const shown = layout.filter((i) => i.visible);
	const hidden = layout.filter((i) => !i.visible);
	return (
		<View style={{ gap: spacing.md }}>
			{shown.map((item, index) => (
				<EditRow
					key={item.id}
					item={item}
					first={index === 0}
					last={index === shown.length - 1}
					onChange={onChange}
					layout={layout}
				/>
			))}
			{shown.length === 0 ? (
				<Text variant="body" tone="secondary">
					Nenhum widget no Início. Adicione abaixo.
				</Text>
			) : null}
			{hidden.length > 0 ? (
				<View style={{ gap: spacing.md, marginTop: spacing.md }}>
					<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
						Adicionar widget
					</Text>
					{hidden.map((item) => (
						<View
							key={item.id}
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: spacing.md,
								backgroundColor: colors.surface,
								borderRadius: radius.card,
								paddingVertical: spacing.md,
								paddingLeft: spacing.xl,
								paddingRight: spacing.md,
							}}
						>
							<Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
								{HOME_WIDGETS[item.id].label}
							</Text>
							<Button
								label="Adicionar"
								variant="secondary"
								compact
								icon="mais"
								onPress={() => onChange(setWidgetVisible(layout, item.id, true))}
							/>
						</View>
					))}
				</View>
			) : null}
		</View>
	);
}

function EditRow({
	item,
	first,
	last,
	layout,
	onChange,
}: {
	item: HomeLayoutItem;
	first: boolean;
	last: boolean;
	layout: HomeLayout;
	onChange: (next: HomeLayout) => void;
}) {
	const def = HOME_WIDGETS[item.id];
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.card,
				padding: spacing.lg,
				paddingLeft: spacing.xl,
				gap: spacing.md,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
					{def.label}
				</Text>
				<IconButton
					icon="seta-cima"
					label={`Subir ${def.label}`}
					background={colors.surface2}
					disabled={first}
					onPress={() => onChange(moveWidget(layout, item.id, -1))}
				/>
				<IconButton
					icon="seta-baixo"
					label={`Descer ${def.label}`}
					background={colors.surface2}
					disabled={last}
					onPress={() => onChange(moveWidget(layout, item.id, 1))}
				/>
				<IconButton
					icon="olho-cortado"
					label={`Ocultar ${def.label}`}
					background={colors.surface2}
					onPress={() => onChange(setWidgetVisible(layout, item.id, false))}
				/>
			</View>
			{def.sizes.length > 1 ? (
				<Segmented
					options={def.sizes.map((s) => ({ id: s, label: s }))}
					value={item.size}
					onChange={(size) => onChange(setWidgetSize(layout, item.id, size))}
				/>
			) : null}
		</View>
	);
}
