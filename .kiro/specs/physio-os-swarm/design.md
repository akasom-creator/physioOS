# Design Document: PhysioOS Swarm Simulation

## Overview

PhysioOS Simulator is a single-page, client-side web application that renders a real-time 3D simulation of programmable nanobot agents navigating a procedurally generated vascular network. The prototype demonstrates distributed quorum consensus for tumor cell detection — the core scientific concept behind the PhysioOS "operating system for programmable biology."

The deliverable is a single self-contained HTML file (with optional split into 3–4 JS files) that runs in any modern desktop browser without a build step or backend.

---

## Architecture

The simulation is divided into four logical layers:

```
┌─────────────────────────────────────────────────────┐
│                   index.html                        │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │   ui.js     │  │ simulation.js│  │  kernel.js │  │
│  │ PhysioAPI   │  │  Three.js    │  │  Consensus │  │
│  │ Control     │  │  Renderer +  │  │  Protocol  │  │
│  │ Panel       │  │  Scene Graph │  │  + HAL     │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                │                │          │
│         └────────────────┼────────────────┘          │
│                          │                           │
│                    Main Loop (requestAnimationFrame)  │
└─────────────────────────────────────────────────────┘
```

- `kernel.js` — Pure simulation logic: vascular graph, agent state, consensus protocol. No Three.js dependency.
- `simulation.js` — Three.js scene setup, rendering, and bridging kernel state to visual objects.
- `ui.js` — DOM control panel, event listeners, stats display.
- `index.html` — Entry point, loads Three.js from CDN, wires all modules together.

For hackathon portability, all four may be inlined into a single `index.html`.

---

## Components and Interfaces

### 1. VascularGraph (kernel.js)

Responsible for procedural network generation and agent pathfinding queries.

```js
class VascularGraph {
  nodes: Node[]           // { id, position: Vector3, children: id[], depth }
  edges: Edge[]           // { from, to, radius, length }
  leafNodes: id[]         // terminal nodes eligible for tumor placement
  
  generate(rootPos, depth, branchFactor)  // recursive L-system builder
  getNeighbors(nodeId): id[]              // adjacency lookup for agent movement
  getEdgeBetween(a, b): Edge             // fetch edge metadata
}
```

Generation algorithm:
- Start at root node at world origin
- At each node, spawn 2–3 children at randomized angles (cone spread ~60°)
- Child radius = parent radius × (1 / branchFactor^(1/3))  ← Murray's Law
- Child length = parent length × 0.7 + small random jitter
- Recurse until depth 4–6
- Cap total nodes at ~300–500 for pathfinding performance

### 2. TumorCellManager (kernel.js)

```js
class TumorCellManager {
  cells: TumorCell[]   // { id, nodeId, position, visits, positiveVotes, state: 'active'|'flagged' }
  falseNodes: id[]     // false signal node ids

  place(graph, count)           // random placement at leaf/deep nodes
  recordVisit(cellId, vote)     // increment visits and conditionally positiveVotes
  checkQuorum(cellId, threshold, minVisits): boolean
  flag(cellId)                  // transition state to 'flagged'
}
```

### 3. Agent (kernel.js)

Each agent is a lightweight state object — no Three.js objects:

```js
{
  id, 
  currentNode: nodeId,
  targetNode: nodeId | null,
  state: 'searching' | 'converging',
  visitHistory: Set<nodeId>,    // for exploration bias
  signalTarget: Vector3 | null  // position received via SIGNAL
}
```

### 4. SwarmKernel (kernel.js)

Orchestrates all agents each tick:

```js
class SwarmKernel {
  tick(agents, graph, tumorManager, config)
    // For each agent:
    //   1. MOVE  — pick next node
    //   2. SENSE — check proximity to tumor cells
    //   3. SIGNAL — broadcast to neighbors if threshold crossed
    //   4. ACTUATE — trigger flagging if quorum met
}
```

### 5. SceneManager (simulation.js)

```js
class SceneManager {
  buildVesselMeshes(graph)        // CylinderGeometry per edge
  buildTumorMeshes(cells)         // SphereGeometry per cell
  buildAgentInstances(count)      // InstancedMesh for agents
  updateAgentPositions(agents)    // write matrix per agent each frame
  flagTumorCell(cellId)           // swap material, trigger pulse tween
  updateTrails(agents)            // particle trail effect
}
```

### 6. UIController (ui.js)

Binds DOM elements to simulation controls. Exposes:
- `onDeploy(agentCount)` callback
- `onRecall()` callback
- `onThresholdChange(value)` callback
- `updateStats(stats)` — called each tick to refresh display

---

## Data Models

### Node
```js
{ id: number, position: {x,y,z}, depth: number, parentId: number|null }
```

### Edge
```js
{ from: number, to: number, radius: number, length: number }
```

### TumorCell
```js
{
  id: number,
  nodeId: number,
  position: {x,y,z},
  isFalseSignal: boolean,
  visits: number,
  positiveVotes: number,
  state: 'active' | 'flagged',
  confidence: number          // positiveVotes / visits, cached
}
```

### Agent
```js
{
  id: number,
  currentNode: number,
  nextNode: number | null,
  progress: number,           // 0–1 interpolation along current edge
  state: 'searching' | 'converging',
  visitHistory: Set<number>,
  signalTarget: {x,y,z} | null,
  signalStrength: number      // decays each tick, drives MOVE bias
}
```

### SimConfig (tunable constants block)
```js
const CONFIG = {
  BRANCH_DEPTH: 5,
  BRANCH_FACTOR: 2,           // children per node (2–3 randomized)
  ROOT_RADIUS: 1.2,
  ROOT_LENGTH: 8,
  TUMOR_COUNT: 40,
  FALSE_SIGNAL_COUNT: 4,
  AGENT_COUNT: 500,           // default, overridden by slider
  QUORUM_THRESHOLD: 0.85,
  MIN_VISITS: 5,
  SENSE_RADIUS: 2.5,
  SIGNAL_RADIUS: 8.0,
  AGENT_SPEED: 0.04,          // progress units per tick
  TRAIL_DECAY: 0.92,
  PULSE_DURATION_MS: 600,
  AUTO_ROTATE_SPEED: 0.003,
  MAX_NODES: 400,
};
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Quorum gate — no premature flagging

*For any* tumor cell, the cell SHALL NOT transition to FLAGGED unless both `positiveVotes / visits >= QUORUM_THRESHOLD` AND `visits >= MIN_VISITS` simultaneously hold true.

**Validates: Requirements 4.2**

---

### Property 2: Quorum monotonicity

*For any* tumor cell that has reached FLAGGED state, the cell SHALL remain in FLAGGED state in all subsequent ticks (flagging is irreversible).

**Validates: Requirements 4.2**

---

### Property 3: False positive isolation

*For any* simulation run, the false positive count SHALL equal exactly the number of false signal nodes whose `positiveVotes / visits >= QUORUM_THRESHOLD` AND `visits >= MIN_VISITS`, and SHALL NOT include true tumor cells.

**Validates: Requirements 4.5**

---

### Property 4: Agent count invariant

*For any* deployed swarm, the total number of active agents SHALL remain constant (equal to the deployed count) throughout the simulation — agents are neither created nor destroyed during a run.

**Validates: Requirements 3.1**

---

### Property 5: Vote bound invariant

*For any* tumor cell, `positiveVotes` SHALL always be less than or equal to `visits`.

**Validates: Requirements 4.1**

---

### Property 6: Threshold slider immediacy

*For any* quorum threshold value set via the slider, the new threshold SHALL be applied by the Swarm Kernel on the very next tick, without requiring a simulation reset.

**Validates: Requirements 5.4**

---

### Property 7: Agent graph confinement

*For any* agent at any tick, the agent's `currentNode` SHALL always be a valid node ID within the VascularGraph's node list.

**Validates: Requirements 3.3**

---

### Property 8: Stats consistency

*For any* simulation tick, the reported "tumor cells flagged" count SHALL equal the number of TumorCell objects in FLAGGED state, and the false positive count SHALL equal the number of false signal nodes in FLAGGED state.

**Validates: Requirements 5.5**

---

### Property 9: Branching radius/length invariant

*For any* edge in the generated vascular graph, the child node's associated radius and length SHALL be strictly less than the parent node's radius and length — this must hold for all edges at all depth levels.

**Validates: Requirements 1.2**

---

### Property 10: Signal propagation to neighbors

*For any* agent whose SENSE detection exceeds the local confidence threshold, all agents within `SIGNAL_RADIUS` of that agent SHALL have their `signalTarget` set to a non-null position value on the next tick.

**Validates: Requirements 3.5, 3.6**

---

## Error Handling

| Scenario | Handling |
|---|---|
| Graph generation produces < 30 leaf nodes | Regenerate with reduced depth or increased branch factor |
| Agent pathfinding reaches a dead-end (leaf with no unvisited neighbors) | Agent backtracks to parent node |
| Tumor cell count exceeds available leaf nodes | Clamp tumor count to leaf node count |
| Browser tab loses focus (visibility API) | Pause requestAnimationFrame loop to avoid drift |
| Three.js WebGL context lost | Display user-facing error overlay with reload prompt |

---

## Testing Strategy

### Property-Based Testing Library

**fast-check** (JavaScript) is used for all property-based tests. It provides arbitrary generators for numbers, arrays, booleans, and custom composites, and runs each property a minimum of 100 iterations.

Since this project ships as a single HTML file with no build system, property tests are written in a companion test file `physio-os-swarm.test.js` that imports the kernel module directly (kernel logic is written as ES modules or CommonJS-compatible for testability).

### Unit Tests

Unit tests cover:
- `VascularGraph.generate()` — verifies node count within bounds, leaf node set is non-empty, all edges reference valid node IDs.
- `TumorCellManager.checkQuorum()` — boundary values: exactly at threshold, just below threshold, exactly at MIN_VISITS.
- `Agent.move()` — dead-end backtracking, unexplored branch preference.
- `UIController.updateStats()` — DOM element content matches passed stats object.

### Property-Based Tests

Each correctness property maps to one `fc.assert(fc.property(...))` test:

| Property | Test Description | fast-check Arbitraries |
|---|---|---|
| P1: Quorum gate | Generate arbitrary cell states; assert FLAGGED only when both conditions hold | `fc.record({ visits: fc.nat(), positiveVotes: fc.nat() })` |
| P2: Quorum monotonicity | Apply tick sequence to FLAGGED cell; assert state unchanged | `fc.array(fc.boolean())` (vote sequence) |
| P3: False positive isolation | Run kernel on mixed cell set; assert FP count = false-signal FLAGGED count only | `fc.array(fc.record({...}))` |
| P4: Agent count invariant | Run N ticks; assert `agents.length` unchanged | `fc.nat({ min: 1, max: 2000 })` |
| P5: Vote bound | Generate arbitrary vote sequences; assert `positiveVotes <= visits` always | `fc.array(fc.boolean())` |
| P6: Threshold slider | Set threshold mid-run; assert applied on next tick | `fc.float({ min: 0.5, max: 1.0 })` |
| P7: Agent graph confinement | Run N ticks; assert all agent `currentNode` in graph node set | `fc.nat({ min: 1, max: 100 })` (tick count) |
| P8: Stats consistency | Compare kernel state to reported stats | N/A — deterministic check |
| P9: Branching radius/length invariant | For all edges in generated graph, assert child radius < parent radius | `fc.record({ depth: fc.nat({min:4,max:6}), branchFactor: fc.nat({min:2,max:3}) })` |
| P10: Signal propagation | Place agent within signal radius after sense threshold crossed; assert neighbors have signalTarget set | `fc.record({ agentPos, neighborPositions })` |

Each property-based test is tagged with:
```js
// **Feature: physio-os-swarm, Property 1: Quorum gate — no premature flagging**
// **Validates: Requirements 4.2**
```
