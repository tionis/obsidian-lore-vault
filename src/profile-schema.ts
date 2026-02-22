export interface TargetOutputConfig {
  enabled: boolean;
  outputPath: string;
}

export interface TargetOutputsConfig {
  lorebookJson?: TargetOutputConfig;
  ragMarkdown?: TargetOutputConfig;
}

export interface TargetExpansionConfig {
  variable: string;
  valuesFromFrontmatterField: string;
}

export interface TargetSelectorConfig {
  mode?: 'all' | 'any';
  includeTags?: string[];
  excludeTags?: string[];
  includeFolders?: string[];
  excludeFolders?: string[];
  includeFrontmatter?: {[key: string]: string};
  excludeFrontmatter?: {[key: string]: string};
}

export interface TargetTemplateConfig {
  id: string;
  description?: string;
  expansion?: TargetExpansionConfig;
  selector?: TargetSelectorConfig;
  outputs: TargetOutputsConfig;
}

export interface FrontmatterSchemaConfig {
  worldField?: string;
  factionField?: string;
  profileField?: string;
}

export interface ProfileConfig {
  version: number;
  frontmatter?: FrontmatterSchemaConfig;
  targets: TargetTemplateConfig[];
}

export interface ResolvedTargetProfile {
  id: string;
  description?: string;
  selector?: TargetSelectorConfig;
  outputs: TargetOutputsConfig;
  variables: {[key: string]: string};
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)]
    .map(value => value.trim())
    .filter(value => value.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function interpolate(template: string, variables: {[key: string]: string}): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => variables[key] ?? '');
}

function interpolateObjectValues(
  input: {[key: string]: string} | undefined,
  variables: {[key: string]: string}
): {[key: string]: string} | undefined {
  if (!input) {
    return undefined;
  }

  const output: {[key: string]: string} = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = interpolate(value, variables);
  }
  return output;
}

function resolveSelector(
  selector: TargetSelectorConfig | undefined,
  variables: {[key: string]: string}
): TargetSelectorConfig | undefined {
  if (!selector) {
    return undefined;
  }

  return {
    ...selector,
    includeFrontmatter: interpolateObjectValues(selector.includeFrontmatter, variables),
    excludeFrontmatter: interpolateObjectValues(selector.excludeFrontmatter, variables)
  };
}

function resolveOutputs(
  outputs: TargetOutputsConfig,
  variables: {[key: string]: string}
): TargetOutputsConfig {
  const resolved: TargetOutputsConfig = {};

  if (outputs.lorebookJson) {
    resolved.lorebookJson = {
      ...outputs.lorebookJson,
      outputPath: interpolate(outputs.lorebookJson.outputPath, variables)
    };
  }

  if (outputs.ragMarkdown) {
    resolved.ragMarkdown = {
      ...outputs.ragMarkdown,
      outputPath: interpolate(outputs.ragMarkdown.outputPath, variables)
    };
  }

  return resolved;
}

export function resolveTargetTemplates(
  config: ProfileConfig,
  frontmatterFieldValues: {[field: string]: string[]}
): ResolvedTargetProfile[] {
  const resolved: ResolvedTargetProfile[] = [];

  for (const template of config.targets) {
    if (!template.expansion) {
      const variables: {[key: string]: string} = {};
      resolved.push({
        id: interpolate(template.id, variables),
        description: template.description,
        selector: resolveSelector(template.selector, variables),
        outputs: resolveOutputs(template.outputs, variables),
        variables
      });
      continue;
    }

    const expansion = template.expansion;
    const values = uniqueSorted(frontmatterFieldValues[expansion.valuesFromFrontmatterField] ?? []);

    for (const value of values) {
      const variables = {
        [expansion.variable]: value
      };

      resolved.push({
        id: interpolate(template.id, variables),
        description: template.description,
        selector: resolveSelector(template.selector, variables),
        outputs: resolveOutputs(template.outputs, variables),
        variables
      });
    }
  }

  return resolved;
}
