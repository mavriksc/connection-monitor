# Graph Report - D:\code\connection-monitor  (2026-04-15)

## Corpus Check
- Corpus is ~1,980 words - fits in a single context window. You may not need a graph.

## Summary
- 19 nodes · 25 edges · 5 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `zipLogsWork()` - 4 edges
2. `writeToFile()` - 3 edges
3. `updateFileListAndEmit()` - 3 edges
4. `zipLogs()` - 3 edges
5. `saveZip()` - 3 edges
6. `logsList()` - 2 edges
7. `startPolling()` - 2 edges
8. `archiveOldLogs()` - 2 edges
9. `addFiles()` - 2 edges
10. `deleteArchivedFiles()` - 2 edges

## Surprising Connections (you probably didn't know these)
- `zipLogsWork()` --calls--> `saveZip()`  [EXTRACTED]
  D:\code\connection-monitor\index.js → D:\code\connection-monitor\index.js  _Bridges community 3 → community 2_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.25
Nodes (0): 

### Community 1 - "Community 1"
Cohesion: 0.5
Nodes (4): logsList(), startPolling(), updateFileListAndEmit(), writeToFile()

### Community 2 - "Community 2"
Cohesion: 0.5
Nodes (4): addFiles(), archiveOldLogs(), zipLogs(), zipLogsWork()

### Community 3 - "Community 3"
Cohesion: 1.0
Nodes (2): deleteArchivedFiles(), saveZip()

### Community 4 - "Community 4"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 3`** (2 nodes): `deleteArchivedFiles()`, `saveZip()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 4`** (1 nodes): `template.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `zipLogsWork()` connect `Community 2` to `Community 0`, `Community 3`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `writeToFile()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `updateFileListAndEmit()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._