import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderOwnBenchmarkReport, type OwnBenchmarkReportInput } from "./own-benchmark-report.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Usage: own-benchmark-report-cli --input results.json --markdown results.md --csv results.csv (missing ${name})`);
  return value;
}

export async function writeOwnBenchmarkReport(inputPath: string, markdownPath: string, csvPath: string): Promise<void> {
  const input = JSON.parse(await readFile(resolve(inputPath), "utf8")) as OwnBenchmarkReportInput;
  const report = renderOwnBenchmarkReport(input);
  await Promise.all([
    writeFile(resolve(markdownPath), report.markdown, "utf8"),
    writeFile(resolve(csvPath), report.csv, "utf8"),
  ]);
}

if (process.argv[1]?.endsWith("own-benchmark-report-cli.ts") || process.argv[1]?.endsWith("own-benchmark-report-cli.js")) {
  void writeOwnBenchmarkReport(argument("--input"), argument("--markdown"), argument("--csv")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
