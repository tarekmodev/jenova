/**
 * Typst rendering pipeline (issue #99; docs/07-tech-stack.md "PDFs").
 *
 * DECISION — Typst over the Playwright-HTML fallback: evaluated on Typst
 * 0.15 with the bundled Noto fonts, Arabic script joins correctly, bidi
 * embedding of Latin references/numbers inside RTL paragraphs is right, and
 * RTL tables mirror properly — Arabic quality decided, and Typst passed.
 * Typst is also deterministic (`document(date: none)` + pinned fonts via
 * `--ignore-system-fonts`): same input JSON → byte-identical PDF, which the
 * rendering suite asserts.
 *
 * Fonts: Noto Naskh Arabic + Noto Sans, bundled under assets/fonts with
 * their SIL OFL 1.1 license texts — no proprietary fonts, ever.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = fileURLToPath(new URL("../assets", import.meta.url));
export const FONTS_DIR = path.join(ASSETS_DIR, "fonts");
export const VOUCHER_TEMPLATE = path.join(ASSETS_DIR, "voucher.typ");

export class DocumentRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRenderError";
  }
}

export interface TypstRenderRequest {
  /** Absolute path of the .typ template to compile. */
  readonly templatePath: string;
  /** JSON-serializable payload surfaced to the template as `sys.inputs.data`. */
  readonly data: unknown;
  /** Extra files placed in the compilation root (e.g. `logo.png` bytes). */
  readonly files?: Readonly<Record<string, Uint8Array>>;
}

export interface TypstRendererOptions {
  /** Typst binary; default `typst` on PATH (DOCUMENTS_TYPST_BIN in config). */
  readonly bin?: string;
  /** Compile budget in ms. */
  readonly timeoutMs?: number;
}

function run(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args as string[],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error !== null && typeof error.code !== "number") {
          // Spawn-level failure (binary missing, timeout kill) — not a compile error.
          reject(new DocumentRenderError(`typst could not run: ${error.message}`));
          return;
        }
        resolve({ code: error === null ? 0 : (error.code as number), stderr });
      },
    );
  });
}

/** True when the configured Typst binary runs — test suites skip without it. */
export async function typstAvailable(bin = "typst"): Promise<boolean> {
  try {
    const { code } = await run(bin, ["--version"], 15_000);
    return code === 0;
  } catch {
    return false;
  }
}

export class TypstRenderer {
  private readonly bin: string;
  private readonly timeoutMs: number;

  constructor(options: TypstRendererOptions = {}) {
    this.bin = options.bin ?? "typst";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /**
   * Compiles the template with the payload and returns the PDF bytes.
   * The compilation root is a throwaway directory holding a copy of the
   * template plus any extra files — the template can read nothing else.
   */
  async render(request: TypstRenderRequest): Promise<Uint8Array> {
    const workDir = await mkdtemp(path.join(tmpdir(), "jenova-typst-"));
    try {
      const mainPath = path.join(workDir, "main.typ");
      await writeFile(mainPath, await readFile(request.templatePath));
      for (const [name, bytes] of Object.entries(request.files ?? {})) {
        if (path.basename(name) !== name) {
          throw new DocumentRenderError(`extra file name must be a bare filename: ${name}`);
        }
        await writeFile(path.join(workDir, name), bytes);
      }
      const outPath = path.join(workDir, "out.pdf");
      const { code, stderr } = await run(
        this.bin,
        [
          "compile",
          "--root",
          workDir,
          "--font-path",
          FONTS_DIR,
          "--ignore-system-fonts",
          "--input",
          `data=${JSON.stringify(request.data)}`,
          mainPath,
          outPath,
        ],
        this.timeoutMs,
      );
      if (code !== 0) {
        throw new DocumentRenderError(`typst compile failed (exit ${String(code)}): ${stderr.trim()}`);
      }
      return await readFile(outPath);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
