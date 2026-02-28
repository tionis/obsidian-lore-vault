import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const SOURCE_ROOT = path.resolve('src');
const IMPORT_RE = /\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const CORE_MODULES = new Set(
  builtinModules
    .flatMap(moduleName => [moduleName, moduleName.replace(/^node:/, '')])
    .map(moduleName => moduleName.replace(/^node:/, ''))
);

/**
 * We keep this list tight and focused on imports that can break mobile runtime.
 * Third-party modules that bundle browser/mobile fallbacks are allowed.
 */
function isForbiddenModule(specifier) {
  if (!specifier) {
    return false;
  }
  const normalized = specifier.replace(/^node:/, '');
  return CORE_MODULES.has(normalized);
}

function toLineColumn(source, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function collectTsFiles(rootDir) {
  const queue = [rootDir];
  const files = [];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.isFile() && absolute.endsWith('.ts')) {
        files.push(absolute);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function scanFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  for (const pattern of [IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      const specifier = match[1] ?? '';
      if (isForbiddenModule(specifier)) {
        const location = toLineColumn(source, match.index);
        violations.push({
          filePath,
          line: location.line,
          column: location.column,
          specifier
        });
      }
      match = pattern.exec(source);
    }
  }

  return violations;
}

function main() {
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error(`Source directory not found: ${SOURCE_ROOT}`);
    process.exit(1);
  }

  const files = collectTsFiles(SOURCE_ROOT);
  const violations = files.flatMap(filePath => scanFile(filePath));

  if (violations.length === 0) {
    console.log('Mobile runtime guard passed: no Node core imports in src/.');
    return;
  }

  console.error('Mobile runtime guard failed: Node core modules imported in src/.');
  for (const violation of violations) {
    const relativePath = path.relative(process.cwd(), violation.filePath).replace(/\\/g, '/');
    console.error(`- ${relativePath}:${violation.line}:${violation.column} imports "${violation.specifier}"`);
  }
  process.exit(1);
}

main();
