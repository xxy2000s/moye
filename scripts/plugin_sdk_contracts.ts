import { BUILTIN_ADAPTER_BRIDGES_V1, verifyBuiltinAdapterBridgesV1 } from "../src/framework/builtin-adapters.js";

const reports = await verifyBuiltinAdapterBridgesV1();
const summary = {
  pluginApiVersion: 1,
  adapterCount: BUILTIN_ADAPTER_BRIDGES_V1.length,
  passed: reports.every((report) => report.passed),
  adapters: reports,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (!summary.passed) process.exitCode = 1;
