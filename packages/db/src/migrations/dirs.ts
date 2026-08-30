import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export const CONTROL_PLANE_MIGRATIONS_DIR = path.join(packageRoot, "migrations", "control-plane");
export const TENANT_MIGRATIONS_DIR = path.join(packageRoot, "migrations", "tenant");
