import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname, '..');
  const files = glob.sync('**/**.test.ts', { cwd: testsRoot });

  files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((c, e) => {
    mocha.run(failures => {
      if (failures > 0) {
        e(new Error(`${failures} tests failed.`));
      } else {
        c();
      }
    });
  });
}
