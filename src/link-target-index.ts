import * as path from 'path';

export function normalizeLinkTarget(target: string): string {
  // Obsidian-style link targets can include headings/block refs and optional .md suffixes.
  return target
    .trim()
    .replace(/\\/g, '/')
    .replace(/#.*$/, '')
    .replace(/\.md$/i, '')
    .trim();
}

export function extractWikilinks(content: string): string[] {
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const rawLink = match[1].trim();
    const link = normalizeLinkTarget(rawLink);
    if (!link) {
      continue;
    }

    links.push(link);

    // Also add the base name as a fallback alias.
    const base = path.basename(link);
    if (base !== link) {
      links.push(base);
    }

    // Add variants with spaces replaced.
    if (link.includes(' ')) {
      links.push(link.replace(/ /g, '-'));
      links.push(link.replace(/ /g, '_'));
    }
  }

  return [...new Set(links)];
}

export class LinkTargetIndex {
  private targetToUid: {[key: string]: number} = {};
  private ambiguousTargets: Set<string> = new Set();

  addTargetMapping(target: string, uid: number): void {
    const normalized = normalizeLinkTarget(target);
    if (!normalized) {
      return;
    }

    if (this.ambiguousTargets.has(normalized)) {
      return;
    }

    const existingUid = this.targetToUid[normalized];
    if (existingUid === undefined) {
      this.targetToUid[normalized] = uid;
      return;
    }

    if (existingUid !== uid) {
      delete this.targetToUid[normalized];
      this.ambiguousTargets.add(normalized);
    }
  }

  registerFileMappings(filePath: string, basename: string, uid: number): void {
    this.addTargetMapping(filePath, uid);
    this.addTargetMapping(basename, uid);
  }

  getMappings(): {[key: string]: number} {
    return this.targetToUid;
  }

  reset(): void {
    this.targetToUid = {};
    this.ambiguousTargets = new Set();
  }
}
