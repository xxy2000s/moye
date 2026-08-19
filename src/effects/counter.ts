import { mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function incrementEffectCounter(
  counterPath: string,
  operationId: string,
): Promise<number> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operationId)) {
    throw new Error(`Invalid effect operation id: ${operationId}`);
  }
  const parent = path.dirname(counterPath);
  const ledgerPath = `${counterPath}.operations`;
  await mkdir(ledgerPath, { recursive: true });
  const operationPath = path.join(ledgerPath, operationId);
  try {
    const operation = await open(operationPath, "wx");
    await operation.writeFile(`${new Date().toISOString()}\n`);
    await operation.close();
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  const next = (await readdir(ledgerPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .length;
  await mkdir(parent, { recursive: true });
  const temporaryPath = `${counterPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${next}\n`);
  await rename(temporaryPath, counterPath);
  return next;
}

export async function readEffectCounter(counterPath: string): Promise<number> {
  return Number.parseInt(await readFile(counterPath, "utf8"), 10);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
