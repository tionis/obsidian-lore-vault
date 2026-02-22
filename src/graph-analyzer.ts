import Graph from 'graphology';
import pagerank from 'graphology-metrics/centrality/pagerank';
import betweenness from 'graphology-metrics/centrality/betweenness';
import { LoreBookEntry } from './models';
import { ConverterSettings } from './models';

export class GraphAnalyzer {
  private graph: Graph = new Graph({ type: 'directed' });
  private entries: {[key: number]: LoreBookEntry};
  private filenameToUid: {[key: string]: number};
  private settings: ConverterSettings;
  private rootUid: number | null;
  
  constructor(
    entries: {[key: number]: LoreBookEntry}, 
    filenameToUid: {[key: string]: number},
    settings: ConverterSettings,
    rootUid: number | null
  ) {
    this.entries = entries;
    this.filenameToUid = filenameToUid;
    this.settings = settings;
    this.rootUid = rootUid;
  }
  
  buildGraph(): void {
    // Initialize the graphology graph
    this.graph = new Graph({ type: 'directed' });
    
    // Add all nodes to the graph
    for (const uid of Object.keys(this.entries).map(Number)) {
      this.graph.addNode(uid.toString(), { 
        entry: this.entries[uid] 
      });
    }
    
    // Add all edges based on wikilinks
    console.log("Building relationship graph based on wikilinks");
    
    for (const [uid, entry] of Object.entries(this.entries)) {
      if (entry.wikilinks) {
        for (const link of entry.wikilinks) {
          if (link in this.filenameToUid) {
            const linkedUid = this.filenameToUid[link];
            if (linkedUid in this.entries) {
              // Create edge from source to target
              try {
                this.graph.addEdge(uid, linkedUid.toString());
              } catch (e) {
                // Edge might already exist, ignore
              }
            }
          }
        }
      }
    }
    
    console.log(`Created graph with ${this.graph.order} nodes and ${this.graph.size} edges`);
  }

  private resolveRootUid(): number | null {
    if (this.rootUid !== null && this.graph.hasNode(this.rootUid.toString())) {
      return this.rootUid;
    }

    if (this.graph.order === 0) {
      return null;
    }

    // Fallback root heuristic: most referenced and connected node.
    let bestNode: string | null = null;
    let bestInDegree = -1;
    let bestTotalDegree = -1;

    this.graph.forEachNode(node => {
      const inDegree = this.graph.inDegree(node);
      const totalDegree = this.graph.degree(node);

      if (
        bestNode === null ||
        inDegree > bestInDegree ||
        (inDegree === bestInDegree && totalDegree > bestTotalDegree) ||
        (inDegree === bestInDegree && totalDegree === bestTotalDegree && parseInt(node) < parseInt(bestNode))
      ) {
        bestNode = node;
        bestInDegree = inDegree;
        bestTotalDegree = totalDegree;
      }
    });

    return bestNode !== null ? parseInt(bestNode) : null;
  }

  calculateEntryPriorities(): void {
    console.log("Calculating entry priorities with graphology");
    
    // Calculate BFS depths from root
    const hierarchyDepths: {[key: number]: number} = {};
    let maxHierarchyDepth = 0;
    const effectiveRootUid = this.resolveRootUid();

    if (this.rootUid !== null) {
      console.log(`Using explicit root UID ${this.rootUid}`);
    } else if (effectiveRootUid !== null) {
      console.log(`No explicit root set; using inferred root UID ${effectiveRootUid}`);
    }
    
    if (effectiveRootUid !== null) {
      const queue: [string, number][] = [[effectiveRootUid.toString(), 0]];
      const visited = new Set<string>([effectiveRootUid.toString()]);
      
      while (queue.length > 0) {
        const [node, depth] = queue.shift()!;
        hierarchyDepths[parseInt(node)] = depth;
        maxHierarchyDepth = Math.max(maxHierarchyDepth, depth);
        
        // Use graphology's outNeighbors method
        this.graph.outNeighbors(node).forEach(neighbor => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push([neighbor, depth + 1]);
          }
        });
      }
    }
    maxHierarchyDepth = Math.max(maxHierarchyDepth, 1);
    
    // Calculate in-degree and out-degree
    const inDegree: {[key: number]: number} = {};
    const outDegree: {[key: number]: number} = {};
    let maxInDegree = 1;
    let maxOutDegree = 1;
    
    this.graph.forEachNode(node => {
      const nodeId = parseInt(node);
      inDegree[nodeId] = this.graph.inDegree(node);
      outDegree[nodeId] = this.graph.outDegree(node);
      
      maxInDegree = Math.max(maxInDegree, inDegree[nodeId]);
      maxOutDegree = Math.max(maxOutDegree, outDegree[nodeId]);
    });
    
    // Calculate total degree
    const totalDegree: {[key: number]: number} = {};
    let maxTotalDegree = 1;
    
    this.graph.forEachNode(node => {
      const nodeId = parseInt(node);
      totalDegree[nodeId] = this.graph.degree(node);
      maxTotalDegree = Math.max(maxTotalDegree, totalDegree[nodeId]);
    });
    
    // Calculate PageRank using graphology-metrics
    const prOptions = {
      alpha: 0.85,
      tolerance: 1e-6,
      maxIterations: 100,
      getEdgeWeight: () => 1
    };
    
    const pageRankResult = pagerank(this.graph, prOptions);
    
    // Convert the results from node strings to numeric UIDs
    const pageRankByUID: {[key: number]: number} = {};
    let maxPageRank = 0;
    
    for (const [node, rank] of Object.entries(pageRankResult)) {
      const nodeId = parseInt(node);
      pageRankByUID[nodeId] = rank;
      maxPageRank = Math.max(maxPageRank, rank);
    }
    maxPageRank = maxPageRank || 1; // Avoid division by zero
    
    // Calculate betweenness centrality using graphology-metrics
    const betweennessResult = betweenness(this.graph);
    
    // Convert the results from node strings to numeric UIDs
    const betweennessByUID: {[key: number]: number} = {};
    let maxBetweenness = 0;
    
    for (const [node, bc] of Object.entries(betweennessResult)) {
      const nodeId = parseInt(node);
      betweennessByUID[nodeId] = bc;
      maxBetweenness = Math.max(maxBetweenness, bc);
    }
    maxBetweenness = maxBetweenness || 1; // Avoid division by zero
    
    // File hierarchy depths
    const fileDepths: {[key: number]: number} = {};
    let maxFileDepth = 1;
    
    for (const [uid, entry] of Object.entries(this.entries)) {
      const depth = entry.group ? entry.group.split('/').length - 1 : 0;
      fileDepths[parseInt(uid)] = depth;
      maxFileDepth = Math.max(maxFileDepth, depth);
    }
    
    // Compute priorities
    const w = this.settings.weights;
    
    for (const uid of Object.keys(this.entries).map(Number)) {
      const hFac = (hierarchyDepths[uid] || 0) / maxHierarchyDepth;
      const iFac = (inDegree[uid] || 0) / maxInDegree;
      const pFac = (pageRankByUID[uid] || 0) / maxPageRank;
      const bFac = (betweennessByUID[uid] || 0) / maxBetweenness;
      const oFac = (outDegree[uid] || 0) / maxOutDegree;
      const tFac = (totalDegree[uid] || 0) / maxTotalDegree;
      const fFac = (fileDepths[uid] || 0) / maxFileDepth;
      
      const score = (
        w.hierarchy * hFac +
        w.in_degree * iFac +
        w.pagerank * pFac +
        w.betweenness * bFac +
        w.out_degree * oFac +
        w.total_degree * tFac +
        w.file_depth * fFac
      );
      
      this.entries[uid].order = Math.max(1, Math.floor(score));
    }
    
    // Break ties deterministically to keep export output stable across runs
    const valueCounts: {[key: number]: number[]} = {};
    
    for (const [node, entry] of Object.entries(this.entries)) {
      const uid = parseInt(node);
      const order = entry.order;
      
      if (!valueCounts[order]) {
        valueCounts[order] = [];
      }
      
      valueCounts[order].push(uid);
    }
    
    for (const [val, nodes] of Object.entries(valueCounts)) {
      if (nodes.length > 1) {
        nodes.sort((a, b) => a - b);

        // Add small offset to break ties
        for (let i = 0; i < nodes.length; i++) {
          this.entries[nodes[i]].order += i + 1;
        }
      }
    }
  }
  
  getGraph(): Graph {
    return this.graph;
  }
}
