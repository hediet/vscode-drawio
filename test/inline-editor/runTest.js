/**
 * Runs both unit tests (mocha) and VS Code integration tests.
 *
 * Usage:
 *   node test/runTest.js          - Run unit tests
 *   node test/runTest.js --vscode - Run VS Code integration tests (requires VS Code)
 */
const path = require('path');

async function runUnitTests()
{
  const Mocha = require('mocha');
  const mocha = new Mocha({ ui: 'bdd', color: true });

  const testDir = path.join(__dirname, 'suite');
  const fs = require('fs');

  fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'))
    .forEach(f => mocha.addFile(path.join(testDir, f)));

  return new Promise((resolve, reject) =>
  {
    mocha.run(failures =>
    {
      if (failures > 0)
      {
        reject(new Error(`${failures} test(s) failed`));
      }
      else
      {
        resolve();
      }
    });
  });
}

async function runVSCodeTests()
{
  const { runTests } = require('@vscode/test-electron');

  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, '..', '..'),
    extensionTestsPath: path.resolve(__dirname, 'suite'),
  });
}

async function main()
{
  const args = process.argv.slice(2);

  if (args.includes('--vscode'))
  {
    console.log('Running VS Code integration tests...');
    await runVSCodeTests();
  }
  else
  {
    console.log('Running unit tests...');
    await runUnitTests();
  }
}

main().catch(err =>
{
  console.error(err);
  process.exit(1);
});
