import { App, PluginSettingTab, Setting } from 'obsidian';
import LoreBookConverterPlugin from './main';

export class LoreBookConverterSettingTab extends PluginSettingTab {
  plugin: LoreBookConverterPlugin;

  constructor(app: App, plugin: LoreBookConverterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('lorebook-converter-settings');

    containerEl.createEl('h2', { text: 'Lorebook Converter Settings' });

    new Setting(containerEl)
      .setName('Output Path')
      .setDesc('Path where the Lorebook JSON file will be saved')
      .addText(text => text
        .setPlaceholder(`${this.app.vault.getName()}.json`)
        .setValue(this.plugin.settings.outputPath)
        .onChange(async (value) => {
          this.plugin.settings.outputPath = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Priority Weights' });
    containerEl.createEl('p', { 
      text: 'These weights determine how entries are ordered in the lorebook. Higher weights give more importance to that factor.'
    });

    // The updated createWeightSetting function
    const createWeightSetting = (key: keyof typeof this.plugin.settings.weights, name: string, desc: string) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText(text => text
          .setValue(this.plugin.settings.weights[key].toString())
          .onChange(async (value) => {
            // Parse the input to a number
            const numValue = parseInt(value);
            
            // Validate the input is a valid number
            if (!isNaN(numValue)) {
              this.plugin.settings.weights[key] = numValue;
              await this.plugin.saveSettings();
            }
          }));
    };

    createWeightSetting('hierarchy', 'Hierarchy', 
      'Distance from root document (lower depth = higher priority)');
    createWeightSetting('in_degree', 'In-Degree', 
      'Number of links pointing to this document');
    createWeightSetting('pagerank', 'PageRank', 
      'Overall importance based on network centrality');
    createWeightSetting('betweenness', 'Betweenness', 
      'How important this node is as a connector');
    createWeightSetting('out_degree', 'Out-Degree', 
      'Number of outgoing links');
    createWeightSetting('total_degree', 'Total Degree', 
      'Total number of links, in + out');
    createWeightSetting('file_depth', 'File Depth', 
      'Position in folder hierarchy');
  }
}