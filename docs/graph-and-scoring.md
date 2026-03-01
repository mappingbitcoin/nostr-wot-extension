# Graph Querying & Scoring

## Graph Querying -- `lib/graph.ts`

### 1. Precomputed BFS Cache

On first query from the root pubkey, `LocalGraph._buildCache(rootPubkey, maxHops)` runs a single BFS pass and stores results in two typed arrays indexed by node ID:

```
hops:  Uint8Array(maxId + 1)   -- stores hop+1 (0 means unreachable)
paths: Uint32Array(maxId + 1)  -- shortest path count per node
```

The BFS visits nodes level by level. For each discovered node:
- **First discovery** (hops[fid] === 0): Set hop distance and copy parent's path count.
- **Same-level rediscovery** (hops[fid] === current hop): Accumulate parent's path count into the node's count.
- **Shorter hop already recorded** (hops[fid] < current hop): Skip.

This correctly counts all shortest paths, including through convergence points where multiple parents at the same level reach the same child.

Built in O(V+E) time, typically ~10ms for 5K nodes.

### 2. O(1) Lookups

After the cache is built, all queries from the root pubkey are O(1) array lookups:

- `getDistance(from, to)` -- returns `hops[toId] - 1` or `null`
- `getDistanceInfo(from, to)` -- returns `{ hops, paths }` or `null`
- `getDistancesBatch(from, targets)` -- checks all targets against cache in a single pass

### 3. Cache Invalidation

The cache is invalidated whenever `new LocalGraph()` is called, which happens on:
- Sync completion (graph data changed)
- Account switch (different graph loaded)
- Graph clear

### 4. Fallback BFS

For queries with an arbitrary source pubkey (not the cached root), `_bfsDistanceInfo()` runs a traditional BFS using `Map` and `Set` collections. This path also counts shortest paths by accumulating path counts at each level.

### 5. Path Finding

`getPath(from, to, maxHops)` runs a BFS with parent tracking (`Map<nodeId, parentId>`), then reconstructs the path by walking the parent chain from target back to source.

---

## Scoring -- `lib/scoring.ts`

### 1. Formula

```
score = base(hops) + min(pathBonus(hops) * (paths - 1), maxPathBonus)
```

Clamped to `[0, 1]`.

### 2. Default Scoring Configuration

```js
{
    distanceWeights: { 1: 1.0, 2: 0.5, 3: 0.25, 4: 0.1 },
    pathBonus:       { 2: 0.15, 3: 0.1, 4: 0.05 },
    maxPathBonus:    0.5
}
```

- **Hop 0** (self): Always returns 1.0.
- **Hop 1** (direct follow): Base 1.0, no path bonus (direct follow always = 100%).
- **Hop 2**: Base 0.5, path bonus 0.15 per additional shortest path.
- **Hop 3**: Base 0.25, path bonus 0.10 per additional shortest path.
- **Hop 4+**: Base 0.1, path bonus 0.05 per additional shortest path.
- **Path bonus cap**: 0.5 (prevents path count from dominating the score).

### 3. Sensitivity Presets

Five presets that adjust `distanceWeights`:

| Preset | 2-hop | 3-hop | 4-hop |
|--------|-------|-------|-------|
| Strict | 0.3 | 0.1 | 0.05 |
| Conservative | 0.4 | 0.15 | 0.08 |
| Balanced (default) | 0.5 | 0.25 | 0.1 |
| Open | 0.6 | 0.35 | 0.15 |
| Very Open | 0.75 | 0.5 | 0.25 |

### 4. Trust Levels

`getTrustLevel(score)` maps numeric scores to human-readable labels:

| Score Range | Label |
|-------------|-------|
| >= 0.9 | Very High |
| >= 0.5 | High |
| >= 0.25 | Medium |
| >= 0.1 | Low |
| < 0.1 | Very Low |
| null | Unknown |
