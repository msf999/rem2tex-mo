/**
 * Runs every suite in this folder against a fake in-memory knowledge base (see fake-kb.ts).
 *   npm test          → all suites; exit code 1 when anything fails
 * Suites are plain async functions returning their failure count, so no test framework is needed
 * (Node 16 + ts-node, transpile-only, per tsconfig's ts-node settings).
 */
import * as pins from './pins.test';
import * as comments from './comments.test';
import * as layout from './layout.test';
import * as regressions from './regressions.test';
import * as ignore from './ignore.test';

(async () => {
  let failures = 0;
  for (const s of [pins, comments, layout, regressions, ignore]) {
    failures += await s.run();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
