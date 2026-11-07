import * as Updates from "expo-updates";
import type { UpdatesPort } from "./updates.ts";

/** Liga a lógica de `updates.ts` ao módulo nativo. Tudo isto só existe em build de release com o certificado. */
export const nativeUpdatesPort: UpdatesPort = {
	get isEnabled() {
		return Updates.isEnabled;
	},
	check: () => Updates.checkForUpdateAsync(),
	download: () => Updates.fetchUpdateAsync(),
};
