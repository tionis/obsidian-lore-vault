import { App, TFile } from 'obsidian';
import { ConverterSettings, ScopePack } from './models';
import { FileProcessor } from './file-processor';
import { GraphAnalyzer } from './graph-analyzer';
import { ProgressBar } from './progress-bar';
import { EmbeddingService } from './embedding-service';
import { chunkRagDocuments } from './rag-chunker';

function cloneSettings(settings: ConverterSettings): ConverterSettings {
  return {
    ...settings,
    tagScoping: { ...settings.tagScoping },
    weights: { ...settings.weights },
    defaultLoreBook: { ...settings.defaultLoreBook },
    defaultEntry: { ...settings.defaultEntry },
    sqlite: { ...settings.sqlite },
    embeddings: { ...settings.embeddings },
    retrieval: { ...settings.retrieval },
    summaries: { ...settings.summaries },
    completion: { ...settings.completion }
  };
}

function createSilentProgress(): ProgressBar {
  return {
    setStatus: () => {},
    update: () => {},
    success: () => {},
    error: () => {},
    close: () => {}
  } as unknown as ProgressBar;
}

export interface ScopePackBuildResult {
  pack: ScopePack;
  scopedSettings: ConverterSettings;
}

export async function buildScopePack(
  app: App,
  settings: ConverterSettings,
  scope: string,
  files: TFile[],
  buildAllScopes: boolean,
  embeddingService: EmbeddingService | null,
  progress?: ProgressBar
): Promise<ScopePackBuildResult> {
  const scopedSettings = cloneSettings(settings);
  scopedSettings.tagScoping.activeScope = scope;
  if (buildAllScopes) {
    scopedSettings.tagScoping.includeUntagged = false;
  }

  const stepper = progress ?? createSilentProgress();
  stepper.setStatus(`Scope ${scope || '(all)'}: processing files...`);

  const fileProcessor = new FileProcessor(app, scopedSettings);
  await fileProcessor.processFiles(files, stepper);

  stepper.setStatus(`Scope ${scope || '(all)'}: building relationship graph...`);
  const graphAnalyzer = new GraphAnalyzer(
    fileProcessor.getEntries(),
    fileProcessor.getFilenameToUid(),
    scopedSettings,
    fileProcessor.getRootUid()
  );
  graphAnalyzer.buildGraph();
  stepper.update();

  stepper.setStatus(`Scope ${scope || '(all)'}: calculating world_info priorities...`);
  graphAnalyzer.calculateEntryPriorities();

  const worldInfoEntries = Object.values(fileProcessor.getEntries()).sort((a, b) => {
    return (
      b.order - a.order ||
      a.uid - b.uid
    );
  });

  const ragDocuments = [...fileProcessor.getRagDocuments()].sort((a, b) => {
    return (
      a.path.localeCompare(b.path) ||
      a.title.localeCompare(b.title) ||
      a.uid - b.uid
    );
  });

  stepper.setStatus(`Scope ${scope || '(all)'}: chunking RAG documents...`);
  const ragChunks = chunkRagDocuments(ragDocuments, scopedSettings.embeddings);
  stepper.update();

  let ragChunkEmbeddings = [] as ScopePack['ragChunkEmbeddings'];
  if (embeddingService && scopedSettings.embeddings.enabled && ragChunks.length > 0) {
    stepper.setStatus(`Scope ${scope || '(all)'}: generating embeddings...`);
    ragChunkEmbeddings = await embeddingService.embedChunks(ragChunks);
    stepper.update();
  }

  return {
    scopedSettings,
    pack: {
      schemaVersion: 1,
      scope,
      generatedAt: Date.now(),
      worldInfoEntries,
      ragDocuments,
      ragChunks,
      ragChunkEmbeddings
    }
  };
}
