const path = require("node:path");

process.chdir(path.join(__dirname, ".."));
let ts;
try {
  ts = require("typescript");
} catch (error) {
  if (!process.env.DDLC_TYPESCRIPT || error.code !== "MODULE_NOT_FOUND") throw error;
  ts = require(process.env.DDLC_TYPESCRIPT);
}
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ".");
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: (name) => name,
    getNewLine: () => "\n",
  }));
  process.exit(1);
}
if (program.emit().emitSkipped) process.exit(1);
console.log(`Compiled with TypeScript ${ts.version}.`);
