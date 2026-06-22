/**
 * physio-os-swarm.test.js
 * Property-based tests for the PhysioOS Swarm Simulation kernel.
 * Uses fast-check for property generation (minimum 100 iterations each).
 */

'use strict';

const fc = require('fast-check');
const { CONFIG, VascularGraph, TumorCellManager, SwarmKernel, computeStats } = require('./kernel.js');

// ─── Shared test fixtures ────────────────────────────────────────────────────

/** Build a minimal graph suitable for fast testing */
function buildTestGraph(overrides = {}) {
    const graph = new VascularGraph();
    graph.generate({ ...CONFIG, BRANCH_DEPTH: 4, MAX_NODES: 100, ...overrides });
    return graph;
}

// Pre-build one graph to reuse across iterations (generation is deterministic
// enough; each fc.property run gets a fresh one via the arbitrary below).

// ─── Property 7: Agent graph confinement ────────────────────────────────────
// **Feature: physio-os-swarm, Property 7: Agent graph confinement**
// **Validates: Requirements 3.3**
//
// For any tick count, every agent's currentNode must be a valid node ID
// present in the VascularGraph's node list.

describe('Property 7: Agent graph confinement', () => {
    test('every agent currentNode is a valid graph node ID after any number of ticks', () => {
        fc.assert(
            fc.property(
                // agent count — small range to keep tests fast
                fc.integer({ min: 10, max: 100 }),
                // tick count
                fc.integer({ min: 1, max: 30 }),
                (n, tickCount) => {
                    const graph = buildTestGraph();
                    const validNodeIds = new Set(graph.nodes.map(node => node.id));

                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    const kernel = new SwarmKernel();
                    kernel.init(n, graph);

                    // Check confinement immediately after init
                    for (const agent of kernel.agents) {
                        if (!validNodeIds.has(agent.currentNode)) return false;
                    }

                    // Check confinement after every tick
                    for (let t = 0; t < tickCount; t++) {
                        kernel.update(graph, tumorManager, CONFIG);
                        for (const agent of kernel.agents) {
                            if (!validNodeIds.has(agent.currentNode)) return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 10: Signal propagation to neighbors ───────────────────────────
// **Feature: physio-os-swarm, Property 10: Signal propagation to neighbors**
// **Validates: Requirements 3.5, 3.6**
//
// For any agent whose signalStrength > 0 (active signaler), all other agents
// positioned within SIGNAL_RADIUS of that agent SHALL have their signalTarget
// set to a non-null value after one tick.

describe('Property 10: Signal propagation to neighbors', () => {
    test('agents within SIGNAL_RADIUS of a signaling agent have signalTarget set after one tick', () => {
        fc.assert(
            fc.property(
                // Number of neighbor agents to place within signal radius
                fc.integer({ min: 1, max: 20 }),
                // The position of the signaling agent (at some graph node)
                fc.integer({ min: 0, max: 5 }),
                (neighborCount, signalerNodeOffset) => {
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    const kernel = new SwarmKernel();
                    kernel.init(1, graph); // init with 1 placeholder; we'll replace agents below

                    // Pick a signaler node — clamp to valid range
                    const signalerNodeId = Math.min(signalerNodeOffset, graph.nodes.length - 1);
                    const signalerPos = graph.nodes[signalerNodeId].position;
                    const signalTarget = { x: signalerPos.x + 1, y: signalerPos.y, z: signalerPos.z };

                    // Build agents array manually:
                    // Agent 0: the signaler — has signalStrength=1 and a signalTarget set
                    // Agents 1..N: neighbors placed at the SAME node (distance 0, well within SIGNAL_RADIUS)
                    const agents = [];

                    // Signaling agent
                    agents.push({
                        id: 0,
                        currentNode: signalerNodeId,
                        nextNode: null,
                        progress: 0,
                        state: 'converging',
                        visitHistory: new Set([signalerNodeId]),
                        signalTarget: { ...signalTarget },
                        signalStrength: 1.0,
                    });

                    // Neighbor agents — at the same node, so distance = 0 < SIGNAL_RADIUS
                    for (let i = 1; i <= neighborCount; i++) {
                        agents.push({
                            id: i,
                            currentNode: signalerNodeId,
                            nextNode: null,
                            progress: 0,
                            state: 'searching',
                            visitHistory: new Set([signalerNodeId]),
                            signalTarget: null,
                            signalStrength: 0,
                        });
                    }

                    // Replace the kernel's agent list and graph reference
                    kernel.agents = agents;
                    kernel._graph = graph;

                    // Run one tick — SIGNAL pass should propagate to all neighbors
                    kernel.update(graph, tumorManager, CONFIG);

                    // Assert: every neighbor (agents[1..N]) has a non-null signalTarget
                    for (let i = 1; i <= neighborCount; i++) {
                        if (agents[i].signalTarget === null) return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 1: Quorum gate — no premature flagging ────────────────────────
// **Feature: physio-os-swarm, Property 1: Quorum gate — no premature flagging**
// **Validates: Requirements 4.2**
//
// For any tumor cell, the cell SHALL NOT transition to FLAGGED unless both
// positiveVotes / visits >= QUORUM_THRESHOLD AND visits >= MIN_VISITS hold.
// Equivalently: checkQuorum() returns true iff both conditions are simultaneously met.

describe('Property 1: Quorum gate — no premature flagging', () => {
    test('checkQuorum returns true iff both gate conditions hold simultaneously', () => {
        fc.assert(
            fc.property(
                // visits: at least 1 so we avoid division by zero
                fc.integer({ min: 1, max: 200 }),
                // positiveVotes: 0..visits (vote bound invariant assumed)
                fc.integer({ min: 0, max: 200 }),
                // threshold: in [0.5, 1.0] per the slider range
                fc.float({ min: 0.5, max: 1.0, noNaN: true }),
                // minVisits: small positive integer
                fc.integer({ min: 1, max: 20 }),
                (visits, rawPositiveVotes, threshold, minVisits) => {
                    // Clamp positiveVotes to visits to stay in valid domain
                    const positiveVotes = Math.min(rawPositiveVotes, visits);

                    // Build a fresh TumorCellManager with a single manually set cell
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    // Overwrite the first cell's state directly
                    const cell = tumorManager.cells[0];
                    cell.visits = visits;
                    cell.positiveVotes = positiveVotes;
                    cell.confidence = positiveVotes / visits;
                    cell.state = 'active';

                    const result = tumorManager.checkQuorum(cell.id, threshold, minVisits);

                    // Expected: true iff BOTH gate conditions hold
                    const expectedTrue =
                        visits >= minVisits &&
                        positiveVotes / visits >= threshold;

                    return result === expectedTrue;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 5: Vote bound invariant ───────────────────────────────────────
// **Feature: physio-os-swarm, Property 5: Vote bound invariant**
// **Validates: Requirements 4.1**
//
// For any tumor cell, positiveVotes SHALL always be <= visits.
// Generated via arbitrary sequences of recordVisit() calls.

describe('Property 5: Vote bound invariant', () => {
    test('positiveVotes never exceeds visits after any sequence of recordVisit calls', () => {
        fc.assert(
            fc.property(
                // Arbitrary sequence of vote booleans (true = positive, false = negative)
                fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }),
                (voteSequence) => {
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    // Use the first cell (guaranteed to exist after place())
                    const cell = tumorManager.cells[0];
                    const cellId = cell.id;

                    for (const vote of voteSequence) {
                        tumorManager.recordVisit(cellId, vote);
                        const c = tumorManager.cells[cellId];
                        if (c.positiveVotes > c.visits) return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 2: Quorum monotonicity ────────────────────────────────────────
// **Feature: physio-os-swarm, Property 2: Quorum monotonicity**
// **Validates: Requirements 4.2**
//
// For any tumor cell that has reached FLAGGED state, the cell SHALL remain in
// FLAGGED state after any additional sequence of recordVisit() calls and
// checkQuorum() evaluations (flagging is irreversible).

describe('Property 2: Quorum monotonicity', () => {
    test('a FLAGGED cell remains flagged after any additional vote sequence', () => {
        fc.assert(
            fc.property(
                // Arbitrary sequence of additional votes after the cell is already flagged
                fc.array(fc.boolean(), { minLength: 0, maxLength: 100 }),
                // Arbitrary threshold and minVisits to use during post-flag checks
                fc.float({ min: 0.5, max: 1.0, noNaN: true }),
                fc.integer({ min: 1, max: 20 }),
                (voteSequence, threshold, minVisits) => {
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    // Directly flag the first cell to set up the precondition
                    const cell = tumorManager.cells[0];
                    const cellId = cell.id;
                    tumorManager.flag(cellId);

                    // Precondition: cell must be flagged before we begin
                    if (tumorManager.cells[cellId].state !== 'flagged') return false;

                    // Apply arbitrary additional votes
                    for (const vote of voteSequence) {
                        tumorManager.recordVisit(cellId, vote);

                        // State must remain 'flagged' after every operation
                        if (tumorManager.cells[cellId].state !== 'flagged') return false;
                    }

                    // checkQuorum on a flagged cell should never trigger a re-flag
                    // (it returns false, so state is unchanged)
                    tumorManager.checkQuorum(cellId, threshold, minVisits);
                    if (tumorManager.cells[cellId].state !== 'flagged') return false;

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 4: Agent count invariant ──────────────────────────────────────
// **Feature: physio-os-swarm, Property 4: Agent count invariant**
// **Validates: Requirements 3.1**
//
// For any N in [200, 2000], after deploying and running N ticks,
// agents.length === N must hold at every tick.

describe('Property 4: Agent count invariant', () => {
    test('agents.length stays equal to deployed count for any N in [200, 2000]', () => {
        fc.assert(
            fc.property(
                // N — agent count
                fc.integer({ min: 200, max: 2000 }),
                // tick count — run at least 1 tick, at most 20 (keep tests fast)
                fc.integer({ min: 1, max: 20 }),
                (n, tickCount) => {
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    const kernel = new SwarmKernel();
                    kernel.init(n, graph);

                    // Count must equal N immediately after init
                    if (kernel.agents.length !== n) return false;

                    // Count must remain N after every tick
                    for (let t = 0; t < tickCount; t++) {
                        kernel.update(graph, tumorManager, CONFIG);
                        if (kernel.agents.length !== n) return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 6: Threshold slider immediacy ─────────────────────────────────
// **Feature: physio-os-swarm, Property 6: Threshold slider immediacy**
// **Validates: Requirements 5.4**
//
// For any threshold value set on CONFIG, the Swarm Kernel SHALL use that
// value on the very next call to update() — no reset required.

describe('Property 6: Threshold slider immediacy', () => {
    test('kernel uses the current CONFIG.QUORUM_THRESHOLD value on the next tick', () => {
        fc.assert(
            fc.property(
                // Arbitrary threshold in valid slider range [0.5, 1.0]
                fc.float({ min: 0.5, max: 1.0, noNaN: true }),
                // Number of extra ticks before we check
                fc.integer({ min: 0, max: 5 }),
                (threshold, preTicks) => {
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    const kernel = new SwarmKernel();
                    kernel.init(20, graph);

                    // Run some ticks with the default threshold
                    const cfg = { ...CONFIG };
                    for (let t = 0; t < preTicks; t++) {
                        kernel.update(graph, tumorManager, cfg);
                    }

                    // Now set the new threshold — simulates slider change
                    cfg.QUORUM_THRESHOLD = threshold;

                    // Capture which cells would be flagged under the new threshold
                    // by checking the gate manually against current cell state
                    const cellsReadyToFlag = tumorManager.cells.filter(c =>
                        c.state === 'active' &&
                        c.visits >= cfg.MIN_VISITS &&
                        c.visits > 0 &&
                        c.positiveVotes / c.visits >= threshold
                    );

                    // Run one tick with the new threshold
                    kernel.update(graph, tumorManager, cfg);

                    // Every cell that met the gate before the tick must now be flagged
                    for (const cell of cellsReadyToFlag) {
                        if (tumorManager.cells[cell.id].state !== 'flagged') return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 8: Stats consistency ──────────────────────────────────────────
// **Feature: physio-os-swarm, Property 8: Stats consistency**
// **Validates: Requirements 5.5**
//
// For any kernel state, the reported flaggedCount SHALL equal the number of
// non-false-signal cells in FLAGGED state, and falsePositives SHALL equal
// the number of false signal nodes in FLAGGED state.

describe('Property 8: Stats consistency', () => {
    test('computeStats flaggedCount and falsePositives match actual cell state', () => {
        fc.assert(
            fc.property(
                // Number of cells to flag (true tumors)
                fc.integer({ min: 0, max: 10 }),
                // Number of false signal cells to flag
                fc.integer({ min: 0, max: 4 }),
                // Agent count
                fc.integer({ min: 1, max: 50 }),
                // Tick value
                fc.integer({ min: 0, max: 1000 }),
                (tumorFlagCount, fpFlagCount, agentCount, tick) => {
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    const trueCells = tumorManager.cells.filter(c => !c.isFalseSignal);
                    const falseCells = tumorManager.cells.filter(c => c.isFalseSignal);

                    // Flag the requested number of true tumor cells
                    const toFlag = Math.min(tumorFlagCount, trueCells.length);
                    for (let i = 0; i < toFlag; i++) {
                        tumorManager.flag(trueCells[i].id);
                    }

                    // Flag the requested number of false signal cells
                    const fpToFlag = Math.min(fpFlagCount, falseCells.length);
                    for (let i = 0; i < fpToFlag; i++) {
                        tumorManager.flag(falseCells[i].id);
                    }

                    // Build dummy agents with known states
                    const agents = Array.from({ length: agentCount }, (_, i) => ({
                        id: i,
                        state: i % 2 === 0 ? 'searching' : 'converging',
                    }));

                    const stats = computeStats(tumorManager.cells, agents, tick);

                    // flaggedCount must match actual flagged true tumor count
                    const actualFlagged = trueCells.filter(c => c.state === 'flagged').length;
                    if (stats.flaggedCount !== actualFlagged) return false;

                    // falsePositives must match actual flagged false signal count
                    const actualFp = falseCells.filter(c => c.state === 'flagged').length;
                    if (stats.falsePositives !== actualFp) return false;

                    // tick must be passed through unchanged
                    if (stats.tick !== tick) return false;

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 3: False positive isolation ───────────────────────────────────
// **Feature: physio-os-swarm, Property 3: False positive isolation**
// **Validates: Requirements 4.5**
//
// The false positive count SHALL equal exactly the number of false signal
// nodes in FLAGGED state — it SHALL NOT include true tumor cells.

describe('Property 3: False positive isolation', () => {
    test('falsePositives count includes only false-signal nodes in FLAGGED state', () => {
        fc.assert(
            fc.property(
                // How many ticks to run
                fc.integer({ min: 1, max: 20 }),
                // Agent count
                fc.integer({ min: 10, max: 100 }),
                (tickCount, agentCount) => {
                    const graph = buildTestGraph();
                    const tumorManager = new TumorCellManager();
                    tumorManager.place(graph, CONFIG);

                    const kernel = new SwarmKernel();
                    kernel.init(agentCount, graph);

                    for (let t = 0; t < tickCount; t++) {
                        kernel.update(graph, tumorManager, CONFIG);
                    }

                    const stats = computeStats(tumorManager.cells, kernel.agents, kernel.tick);

                    // The reported false positive count must equal the number of
                    // false-signal cells that are flagged — never any true tumor cells
                    const actualFp = tumorManager.cells.filter(
                        c => c.isFalseSignal && c.state === 'flagged'
                    ).length;

                    if (stats.falsePositives !== actualFp) return false;

                    // True tumor cells flagged must NOT be counted as false positives
                    const trueFlaggedAsFp = tumorManager.cells.filter(
                        c => !c.isFalseSignal && c.state === 'flagged'
                    ).length;

                    // If any true tumor was flagged, false positives must not include them
                    if (trueFlaggedAsFp > 0 && stats.falsePositives === stats.flaggedCount + trueFlaggedAsFp) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 9: Branching radius/length invariant ──────────────────────────
// **Feature: physio-os-swarm, Property 9: Branching radius/length invariant**
// **Validates: Requirements 1.2**
//
// For any edge in the generated vascular graph, the child node's associated
// radius and length SHALL be strictly less than the parent edge's radius and length.

describe('Property 9: Branching radius/length invariant', () => {
    test('every child edge has strictly smaller radius and length than its parent edge', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 4, max: 6 }),   // BRANCH_DEPTH
                fc.integer({ min: 2, max: 3 }),   // BRANCH_FACTOR
                (depth, branchFactor) => {
                    const graph = new VascularGraph();
                    graph.generate({ ...CONFIG, BRANCH_DEPTH: depth, BRANCH_FACTOR: branchFactor, MAX_NODES: 200 });

                    // Build a map from nodeId -> edge that connects parent->child
                    // (the edge whose 'to' === nodeId)
                    const edgeByChildNode = {};
                    for (const edge of graph.edges) {
                        edgeByChildNode[edge.to] = edge;
                    }

                    // For every non-root edge, find its parent edge and compare
                    for (const edge of graph.edges) {
                        const parentEdge = edgeByChildNode[edge.from];
                        if (!parentEdge) continue; // edge.from is root — no parent edge to compare

                        // Child radius must be strictly less than parent radius
                        if (edge.radius >= parentEdge.radius) return false;

                        // Child length must be strictly less than parent length
                        // (parent length * (0.7 + jitter) where jitter in [-0.1, 0.1]
                        //  so minimum child length = parent * 0.6 — always < parent for positive lengths)
                        if (edge.length >= parentEdge.length) return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
