import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../src/Config';

interface TestYml {
  host: string;
  testParams: Record<string, unknown>;
}

interface TestOptions {
  url: string;
  testconfig: Record<string, unknown>;
}

interface TestData {
  args: string[];
  timeout: number;
}

interface TestModule {
  defaultArgs: string[];
  main(data: TestData, options: TestOptions): Promise<void>;
}

type TestStatus = 'PASS' | 'FAIL' | 'TIMEOUT';

interface TestResult {
  filename: string;
  status: TestStatus;
  elapsed: number;
  errorMessage?: string;
}

function parseArgv(argv: string[]): { filename: string | undefined; timeout: number; args: string[] } {
  const scriptArgs = argv.slice(2);
  let filename: string | undefined;
  let timeout = 30;
  const args: string[] = [];

  for (let i = 0; i < scriptArgs.length; i++) {
    const arg = scriptArgs[i];
    if (arg === undefined) continue;
    if (arg === '--timeout') {
      const next = scriptArgs[i + 1];
      if (next !== undefined) {
        timeout = parseInt(next, 10);
        i++;
      }
    } else if (filename === undefined && !arg.startsWith('--')) {
      filename = arg;
    } else if (!arg.startsWith('--')) {
      args.push(arg);
    }
  }

  return { filename, timeout, args };
}

function loadTestYml(): TestYml {
  const cfg = new Config('test');
  return {
    host: cfg.get<string>('host'),
    testParams: cfg.get<Record<string, unknown>>('testParams'),
  };
}

function buildOptions(yml: TestYml, filename: string): TestOptions {
  const rawConfig = yml.testParams[filename];
  const testconfig = (rawConfig !== null && typeof rawConfig === 'object' && !Array.isArray(rawConfig))
    ? (rawConfig as Record<string, unknown>)
    : {};
  return {
    url: `ws://${yml.host}`,
    testconfig,
  };
}

function discoverTestFiles(): string[] {
  const testsDir = __dirname;
  return fs
    .readdirSync(testsDir)
    .filter(f => f.endsWith('.ts') && f !== 'runtest.ts')
    .sort();
}

async function runSingleTest(filename: string, data: TestData, options: TestOptions): Promise<TestResult> {
  const filePath = path.resolve(__dirname, filename);
  const startedAt = Date.now();

  try {
    const testModule = require(filePath) as TestModule;
    const testPromise = testModule.main(data, options);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), data.timeout * 1000)
    );

    await Promise.race([testPromise, timeoutPromise]);

    return { filename, status: 'PASS', elapsed: Date.now() - startedAt };
  } catch (e) {
    const elapsed = Date.now() - startedAt;
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'TIMEOUT') {
      return { filename, status: 'TIMEOUT', elapsed };
    }
    return { filename, status: 'FAIL', elapsed, errorMessage: message };
  }
}

function formatResults(results: TestResult[]): void {
  const maxNameLength = Math.max(...results.map(r => r.filename.length));

  for (const result of results) {
    const name = result.filename.padEnd(maxNameLength);
    const status = result.status.padEnd(7);
    const elapsed = `${result.elapsed}ms`;
    const error = result.errorMessage !== undefined ? `  ${result.errorMessage}` : '';
    console.log(`${name}  ${status}  ${elapsed}${error}`);
  }
}

async function main(): Promise<void> {
  const { filename, timeout, args } = parseArgv(process.argv);
  const yml = loadTestYml();

  if (filename !== undefined) {
    const options = buildOptions(yml, filename);
    const data: TestData = { args, timeout };
    const result = await runSingleTest(filename, data, options);
    formatResults([result]);
    if (result.status !== 'PASS') {
      process.exitCode = 1;
    }
  } else {
    const testFiles = discoverTestFiles();
    const results: TestResult[] = [];

    for (const file of testFiles) {
      const testModule = require(path.resolve(__dirname, file)) as TestModule;
      const options = buildOptions(yml, file);
      const data: TestData = { args: testModule.defaultArgs, timeout };
      const result = await runSingleTest(file, data, options);
      results.push(result);
    }

    formatResults(results);

    if (results.some(r => r.status !== 'PASS')) {
      process.exitCode = 1;
    }
  }
}

main().catch(err => {
  console.error('Runner error:', err);
  process.exitCode = 1;
});
