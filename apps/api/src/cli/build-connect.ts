import { CONNECT_DIST_DIR } from "../modules/pluggy/connect/assets.ts";
import { bundleConnectWidget, writeConnectWidget } from "../modules/pluggy/connect/build.ts";

/** `pnpm --filter @orbita/api build:connect`: empacota o widget do Pluggy Connect para o servidor servir. */
const name = await writeConnectWidget(CONNECT_DIST_DIR, await bundleConnectWidget());
console.log(`widget do Pluggy Connect gravado em ${CONNECT_DIST_DIR}${name}`);
