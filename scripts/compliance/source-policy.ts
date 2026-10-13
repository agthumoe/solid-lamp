import ts from 'typescript';
import { dirname, resolve } from 'node:path';

export function sourceViolations(path: string, text: string): string[] {
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const problems: string[] = [];
  if (/\.[cm]?jsx?$/.test(path)) problems.push('authored runtime must use TypeScript');
  const normalized = path.replaceAll('\\', '/');
  const frontend = normalized.endsWith('.tsx') && normalized.includes('/web/');
  const domain = normalized.includes('/domain/');
  const route = normalized.includes('/transport/') || /-routes\.[cm]?tsx?$/.test(normalized);
  const lines = text.split('\n').filter((line) => line.trim()).length;
  if (frontend && lines > 250) problems.push('frontend file exceeds 250 nonblank lines');
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const imported = node.moduleSpecifier.text;
      if (
        domain &&
        /(?:fastify|react|drizzle|pino|ollama|\/infrastructure\/|@aetherion\/(?:db|llm))/.test(
          imported,
        )
      )
        problems.push('domain imports infrastructure/framework');
      if (route && /(?:drizzle|@aetherion\/db|\/db\/)/.test(imported))
        problems.push('transport imports database directly');
      if (/^(?:openai|@anthropic-ai\/sdk|@google\/generative-ai|@ai-sdk\/)/.test(imported))
        problems.push('cloud inference SDK import');
      const originFeature = normalized.match(/\/features\/([^/]+)\//)?.[1];
      const target = imported.startsWith('.')
        ? resolve(dirname(path), imported).replaceAll('\\', '/')
        : imported;
      const targetFeature = target.match(/\/features\/([^/]+)\//)?.[1];
      if (originFeature && targetFeature && originFeature !== targetFeature)
        problems.push('cross-feature deep import');
      const originApp = normalized.match(/\/apps\/([^/]+)\//)?.[1];
      const targetApp = target.match(/\/apps\/([^/]+)\//)?.[1];
      if (originApp && targetApp && originApp !== targetApp)
        problems.push('cross-app source import');
    }
    if (ts.isStringLiteral(node) && node.text === ['0', '0', '0', '0'].join('.'))
      problems.push('wildcard network binding');
    if (
      frontend &&
      (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    ) {
      const name = ts.isFunctionDeclaration(node)
        ? node.name?.text
        : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
          ? node.parent.name.text
          : '';
      const isDefault =
        ts.isExportAssignment(node.parent) ||
        (ts.isFunctionDeclaration(node) &&
          node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
      if ((name && /^[A-Z]/.test(name)) || isDefault) {
        const size = node
          .getText(file)
          .split('\n')
          .filter((line) => line.trim()).length;
        if (size > 150) problems.push(`${name ?? 'default'}: component exceeds 150 nonblank lines`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return problems;
}
