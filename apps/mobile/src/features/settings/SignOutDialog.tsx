import { useSession } from "../../lib/session.tsx";
import { ConfirmDialog } from "../../ui/index.ts";

export const SIGN_OUT_TITLE = "Desconectar este aparelho?";
export const SIGN_OUT_MESSAGE =
	"O servidor deixa de reconhecer este aparelho. Se ele for o único conectado, um código novo aparece nos logs do servidor para você conectar de novo.";

/** Confirmação de sair deste aparelho (única; "Sair" e "Trocar servidor" usam o mesmo fluxo da sessão). */
export function SignOutDialog({
	visible,
	onCancel,
	title = SIGN_OUT_TITLE,
	message = SIGN_OUT_MESSAGE,
	confirmLabel = "Desconectar",
}: {
	visible: boolean;
	onCancel: () => void;
	title?: string;
	message?: string;
	confirmLabel?: string;
}) {
	const { signOut } = useSession();
	return (
		<ConfirmDialog
			visible={visible}
			title={title}
			message={message}
			confirmLabel={confirmLabel}
			onCancel={onCancel}
			onConfirm={() => {
				onCancel();
				void signOut();
			}}
		/>
	);
}
