import { resolveConfig, format } from 'prettier';
import { stringify } from 'yaml';

/**
 * Serializes the OpenAPI document to the exact text committed as
 * `openapi.yaml` (dev tooling, kept out of the production build with the other
 * test support). The text goes through Prettier with the repository's own
 * configuration: lint-staged and CI run Prettier over YAML files, so output it
 * would rewrite could never match the committed file.
 *
 * Deterministic on purpose: no timestamps, keys in the order the builder
 * emits them, and line endings normalized so Windows checkouts compare equal.
 */
export const renderOpenApiYaml = async (document: unknown, filePath: string): Promise<string> => {
  // A JSON round trip drops `undefined` values and turns any shared object
  // reference into a plain copy, so the YAML never contains anchors.
  const plain: unknown = JSON.parse(JSON.stringify(document));
  const raw = stringify(plain, { lineWidth: 0, aliasDuplicateObjects: false });
  const options = (await resolveConfig(filePath)) ?? {};
  return (await format(raw, { ...options, parser: 'yaml', filepath: filePath })).replaceAll(
    '\r\n',
    '\n',
  );
};

export const normalizeLineEndings = (text: string): string => text.replaceAll('\r\n', '\n');
