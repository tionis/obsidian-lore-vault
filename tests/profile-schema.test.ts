import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileConfig, resolveTargetTemplates } from '../src/profile-schema';

test('profile schema resolves wildcard world targets in deterministic order', () => {
  const config: ProfileConfig = {
    version: 1,
    targets: [
      {
        id: 'core',
        outputs: {
          lorebookJson: {
            enabled: true,
            outputPath: 'exports/lorebooks/core.json'
          }
        }
      },
      {
        id: 'world:{world}',
        expansion: {
          variable: 'world',
          valuesFromFrontmatterField: 'world'
        },
        selector: {
          includeFrontmatter: {
            world: '{world}'
          }
        },
        outputs: {
          lorebookJson: {
            enabled: true,
            outputPath: 'exports/lorebooks/world-{world}.json'
          }
        }
      },
      {
        id: 'world:{world}:factions',
        expansion: {
          variable: 'world',
          valuesFromFrontmatterField: 'world'
        },
        selector: {
          includeFrontmatter: {
            world: '{world}',
            type: 'faction'
          }
        },
        outputs: {
          ragMarkdown: {
            enabled: true,
            outputPath: 'exports/databank/world-{world}-factions.md'
          }
        }
      }
    ]
  };

  const resolved = resolveTargetTemplates(config, {
    world: ['Nexus', 'Aurelia', 'Aurelia', 'Zerith']
  });

  assert.deepEqual(
    resolved.map(target => target.id),
    [
      'core',
      'world:Aurelia',
      'world:Nexus',
      'world:Zerith',
      'world:Aurelia:factions',
      'world:Nexus:factions',
      'world:Zerith:factions'
    ]
  );

  assert.equal(
    resolved.find(target => target.id === 'world:Aurelia')?.outputs.lorebookJson?.outputPath,
    'exports/lorebooks/world-Aurelia.json'
  );
  assert.equal(
    resolved.find(target => target.id === 'world:Aurelia:factions')?.outputs.ragMarkdown?.outputPath,
    'exports/databank/world-Aurelia-factions.md'
  );
  assert.equal(
    resolved.find(target => target.id === 'world:Aurelia')?.selector?.includeFrontmatter?.world,
    'Aurelia'
  );
});
