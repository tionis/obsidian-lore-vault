interface DirectiveMatch {
  index: number;
  text: string;
  order: number;
}

const BRACKET_DIRECTIVE_PATTERN = /\[\s*LV:\s*([^\]\r\n]+?)\s*\]/gi;
const COMMENT_DIRECTIVE_PATTERN = /<!--\s*LV:\s*([\s\S]*?)-->/gi;

function normalizeDirectiveText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractInlineLoreDirectives(source: string): string[] {
  if (!source) {
    return [];
  }

  const matches: DirectiveMatch[] = [];
  let order = 0;

  BRACKET_DIRECTIVE_PATTERN.lastIndex = 0;
  let bracketMatch = BRACKET_DIRECTIVE_PATTERN.exec(source);
  while (bracketMatch) {
    const text = normalizeDirectiveText(bracketMatch[1] ?? '');
    if (text) {
      matches.push({
        index: bracketMatch.index,
        text,
        order
      });
      order += 1;
    }
    bracketMatch = BRACKET_DIRECTIVE_PATTERN.exec(source);
  }

  COMMENT_DIRECTIVE_PATTERN.lastIndex = 0;
  let commentMatch = COMMENT_DIRECTIVE_PATTERN.exec(source);
  while (commentMatch) {
    const text = normalizeDirectiveText(commentMatch[1] ?? '');
    if (text) {
      matches.push({
        index: commentMatch.index,
        text,
        order
      });
      order += 1;
    }
    commentMatch = COMMENT_DIRECTIVE_PATTERN.exec(source);
  }

  matches.sort((left, right) => {
    if (left.index !== right.index) {
      return left.index - right.index;
    }
    return left.order - right.order;
  });

  const directives: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const key = normalizeDirectiveText(match.text).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    directives.push(match.text);
  }

  return directives;
}

export function stripInlineLoreDirectives(source: string): string {
  if (!source) {
    return '';
  }

  return source
    .replace(COMMENT_DIRECTIVE_PATTERN, '')
    .replace(BRACKET_DIRECTIVE_PATTERN, '');
}
