/**
 * Writes the OpenAPI document to `openapi.yaml` at the repository root, or
 * with `--check` fails when the committed file is stale.
 *
 *   npm run openapi:export   regenerate the file
 *   npm run openapi:check    CI: exit 1 if the committed file differs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openApiDocument } from '../src/infrastructure/openapi/openapi.spec.js';
import { normalizeLineEndings, renderOpenApiYaml } from '../src/shared/testing/openapi-yaml.js';

const target = resolve(import.meta.dirname, '..', 'openapi.yaml');
const expected = await renderOpenApiYaml(openApiDocument, target);

if (process.argv.includes('--check')) {
  const committed = await readFile(target, 'utf8').catch(() => '');
  if (normalizeLineEndings(committed) !== expected) {
    process.stderr.write(
      'openapi.yaml is out of date. Run `npm run openapi:export` and commit it.\n',
    );
    process.exit(1);
  }
  process.stdout.write('openapi.yaml is up to date.\n');
} else {
  await writeFile(target, expected, 'utf8');
  process.stdout.write(`Wrote ${target}\n`);
}
