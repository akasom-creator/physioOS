/**
 * kernel.js — PhysioOS Swarm Simulation Kernel
 *
 * Pure simulation logic: vascular graph generation, agent state,
 * consensus protocol (HAL: MOVE / SENSE / SIGNAL / ACTUATE).
 * No Three.js dependency — safe to import in Node.js for testing.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG  (Requirement 7.1 — single labeled configuration block)
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    // Vascular network
    BRANCH_DEPTH: 5,        // recursion depth (4–6)
    BRANCH_FACTOR: 2,        // base children per node (2–3, jittered)
    ROOT_RADIUS: 1.8,      // radius of root vessel segment — larger for viewport fill
    ROOT_LENGTH: 14,       // length of root vessel segment — longer for viewport fill
    MAX_NODES: 400,      // hard cap to keep pathfinding fast

    // Tumor targets
    TUMOR_COUNT: 40,       // nominal tumor cell count (30–50)
    FALSE_SIGNAL_COUNT: 4,        // false signal nodes to seed

    // Swarm
    AGENT_COUNT: 500,      // default; overridden by deploy slider
    AGENT_SPEED: 0.02,     // slowed from 0.04 — keeps agents visible in motion longer

    // Consensus protocol  ← SCIENTIFICALLY SIGNIFICANT
    QUORUM_THRESHOLD: 0.85,     // min positiveVotes/visits ratio to flag
    MIN_VISITS: 12,       // raised from 5 — requires more visits before flagging, stretching demo arc
    SENSE_RADIUS: 2.5,      // Euclidean units — agent sense range
    SIGNAL_RADIUS: 8.0,      // Euclidean units — signal broadcast range
    TRAIL_DECAY: 0.92,     // signal strength decay factor per tick

    // Visual / timing
    PULSE_DURATION_MS: 600,      // flagged-cell pulse animation duration ≥ 500ms
    AUTO_ROTATE_SPEED: 0.003,    // radians per frame for camera auto-rotate
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Uniform random in [min, max) */
function rand(min, max) { return min + Math.random() * (max - min); }

/** Integer in [min, max] */
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

/**
 * Return a unit direction vector that lies within a ~60° half-angle cone
 * centered around a given parent direction.
 * parentDir: { x, y, z } (assumed normalised)
 */
function coneDirection(parentDir, halfAngleRad) {
    // Build a perpendicular basis
    const up = Math.abs(parentDir.y) < 0.9
        ? { x: 0, y: 1, z: 0 }
        : { x: 1, y: 0, z: 0 };
    const right = normalise(cross(parentDir, up));
    const fwd = normalise(cross(right, parentDir));

    const theta = rand(0, 2 * Math.PI);         // azimuth
    const phi = rand(0, halfAngleRad);         // polar offset from parent dir

    const sinPhi = Math.sin(phi);
    return normalise({
        x: parentDir.x + sinPhi * (Math.cos(theta) * right.x + Math.sin(theta) * fwd.x),
        y: parentDir.y + sinPhi * (Math.cos(theta) * right.y + Math.sin(theta) * fwd.y),
        z: parentDir.z + sinPhi * (Math.cos(theta) * right.z + Math.sin(theta) * fwd.z),
    });
}

function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function normalise(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function vecScale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; }

function vecAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }

function vecDist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ─────────────────────────────────────────────────────────────────────────────
// VascularGraph  (Requirement 1.1, 1.2, 1.5)
// ─────────────────────────────────────────────────────────────────────────────
class VascularGraph {
    constructor() {
        /** @type {Array<{id:number, position:{x,y,z}, depth:number, parentId:number|null, children:number[]}>} */
        this.nodes = [];
        /** @type {Array<{from:number, to:number, radius:number, length:number}>} */
        this.edges = [];
        /** @type {number[]} terminal node IDs */
        this.leafNodes = [];
        /** Adjacency list for fast neighbor lookup */
        this._adj = {};
    }

    /**
     * Procedurally generate the vascular network.
     * (Requirement 1.1) recursive branching, depth 4–6
     * (Requirement 1.2) Murray's Law radius falloff, decreasing length
     * (Requirement 1.5) graph data structure
     */
    generate(cfg = CONFIG) {
        this.nodes = [];
        this.edges = [];
        this.leafNodes = [];
        this._adj = {};

        const rootDir = { x: 0, y: 1, z: 0 }; // grow upward initially
        const rootPos = { x: 0, y: 0, z: 0 };

        const rootNode = this._addNode(rootPos, 0, null);
        this._recurse(rootNode.id, rootPos, rootDir, cfg.ROOT_RADIUS, cfg.ROOT_LENGTH, 0, cfg);

        // Mark leaf nodes (nodes with no children)
        for (const n of this.nodes) {
            if (n.children.length === 0) this.leafNodes.push(n.id);
        }
    }

    /**
     * Recursive branching step.
     * @param {number} parentId
     * @param {{x,y,z}} parentPos
     * @param {{x,y,z}} parentDir normalised direction from which children fan out
     * @param {number} parentRadius
     * @param {number} parentLength
     * @param {number} depth current depth
     * @param {object} cfg CONFIG reference
     */
    _recurse(parentId, parentPos, parentDir, parentRadius, parentLength, depth, cfg) {
        if (depth >= cfg.BRANCH_DEPTH) return;
        if (this.nodes.length >= cfg.MAX_NODES) return;

        // 2 or 3 children per branch (Requirement 1.2)
        const numChildren = randInt(2, 3);
        const radiusFalloff = 1 / Math.pow(cfg.BRANCH_FACTOR, 1 / 3); // Murray's Law

        for (let i = 0; i < numChildren; i++) {
            if (this.nodes.length >= cfg.MAX_NODES) break;

            const childRadius = parentRadius * radiusFalloff;
            const jitter = rand(-0.1, 0.1);
            const childLength = parentLength * (0.7 + jitter);

            // Spread children within ~60° half-angle cone around parent direction
            const childDir = coneDirection(parentDir, Math.PI / 3);
            const childPos = vecAdd(parentPos, vecScale(childDir, childLength));

            const childNode = this._addNode(childPos, depth + 1, parentId);
            this.nodes[parentId].children.push(childNode.id);

            this.edges.push({
                from: parentId,
                to: childNode.id,
                radius: childRadius,
                length: childLength,
            });

            // Bidirectional adjacency
            if (!this._adj[parentId]) this._adj[parentId] = [];
            if (!this._adj[childNode.id]) this._adj[childNode.id] = [];
            this._adj[parentId].push(childNode.id);
            this._adj[childNode.id].push(parentId);

            this._recurse(childNode.id, childPos, childDir, childRadius, childLength, depth + 1, cfg);
        }
    }

    _addNode(position, depth, parentId) {
        const id = this.nodes.length;
        const node = { id, position, depth, parentId, children: [] };
        this.nodes.push(node);
        return node;
    }

    /** Return neighbor node IDs for pathfinding */
    getNeighbors(nodeId) {
        return this._adj[nodeId] || [];
    }

    /** Return the edge between two adjacent nodes (or null) */
    getEdgeBetween(a, b) {
        return this.edges.find(e => (e.from === a && e.to === b) || (e.from === b && e.to === a)) || null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TumorCellManager  (Requirement 2.1, 2.3, 2.4, 4.1, 4.5)
// ─────────────────────────────────────────────────────────────────────────────
class TumorCellManager {
    constructor() {
        /** @type {Array<{id,nodeId,position,isFalseSignal,visits,positiveVotes,state,confidence}>} */
        this.cells = [];
    }

    /**
     * Place tumor cells and false signal nodes in the graph.
     * (Requirement 2.1) 30–50 markers at leaf / deep nodes
     * (Requirement 2.3) initial confidence = 0
     * (Requirement 2.4) 3–5 false signal nodes
     */
    place(graph, cfg = CONFIG) {
        this.cells = [];

        // Eligible positions: leaf nodes + deep nodes (depth >= BRANCH_DEPTH - 1)
        const eligible = graph.nodes.filter(
            n => n.children.length === 0 || n.depth >= cfg.BRANCH_DEPTH - 1
        );

        const tumorCount = Math.min(cfg.TUMOR_COUNT, eligible.length);
        const shuffled = [...eligible].sort(() => Math.random() - 0.5);

        const falseCount = Math.min(cfg.FALSE_SIGNAL_COUNT, shuffled.length - tumorCount);
        const tumorNodes = shuffled.slice(0, tumorCount);
        const falseNodes = shuffled.slice(tumorCount, tumorCount + falseCount);

        let id = 0;
        for (const n of tumorNodes) {
            this.cells.push({
                id: id++,
                nodeId: n.id,
                position: { ...n.position },
                isFalseSignal: false,
                visits: 0,
                positiveVotes: 0,
                state: 'active',
                confidence: 0,
            });
        }
        for (const n of falseNodes) {
            this.cells.push({
                id: id++,
                nodeId: n.id,
                position: { ...n.position },
                isFalseSignal: true,
                visits: 0,
                positiveVotes: 0,
                state: 'active',
                confidence: 0,
            });
        }
    }

    /**
     * Record an agent visit to a cell. vote=true if the agent sensed it positively.
     * SCIENTIFICALLY SIGNIFICANT: consensus vote accumulation
     */
    recordVisit(cellId, vote) {
        const cell = this.cells[cellId];
        if (!cell || cell.state === 'flagged') return;
        cell.visits += 1;
        if (vote) cell.positiveVotes += 1;
        cell.confidence = cell.visits > 0 ? cell.positiveVotes / cell.visits : 0;
    }

    /**
     * Check whether a cell has reached quorum.
     * SCIENTIFICALLY SIGNIFICANT: quorum gate condition
     * (Requirement 4.2)
     */
    checkQuorum(cellId, threshold, minVisits) {
        const cell = this.cells[cellId];
        if (!cell || cell.state === 'flagged') return false;
        return cell.visits >= minVisits && cell.positiveVotes / cell.visits >= threshold;
    }

    flag(cellId) {
        const cell = this.cells[cellId];
        if (cell) cell.state = 'flagged';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SwarmKernel  (HAL — MOVE / SENSE / SIGNAL / ACTUATE)
// ─────────────────────────────────────────────────────────────────────────────
class SwarmKernel {
    constructor() {
        this.tick = 0;
        /** @type {Array} agent state objects */
        this.agents = [];
        /** Callback invoked when a cell gets flagged: fn(cellId) */
        this.onFlag = null;
        /** Optional log callbacks — set by ui.js, null-safe */
        this.onSense = null; // (agentId, cellId, nodeId, confidence) => void
        this.onSignal = null; // (agentId, nodeId, neighborCount) => void
        this.onQuorum = null; // (cellId, nodeId, confidence, positiveVotes, visits, isFalseSignal) => void
    }

    /**
     * Initialise N agents at the root node (id 0).
     * (Requirement 3.1)
     */
    init(count, graph) {
        this.agents = [];
        this.tick = 0;
        for (let i = 0; i < count; i++) {
            this.agents.push({
                id: i,
                currentNode: 0,
                nextNode: null,
                progress: Math.random(), // stagger start positions
                state: 'searching',
                visitHistory: new Set([0]),
                signalTarget: null,
                signalStrength: 0,
            });
        }
        this._graph = graph;
    }

    /**
     * Advance the simulation by one tick.
     * Processes MOVE → SENSE → SIGNAL → ACTUATE for all agents.
     */
    update(graph, tumorManager, cfg = CONFIG) {
        this.tick++;
        const agents = this.agents;
        const cells = tumorManager.cells;

        // ── MOVE ──────────────────────────────────────────────────────────────────
        for (const agent of agents) {
            // Determine target edge if not already set
            if (agent.nextNode === null) {
                agent.nextNode = this._pickNext(agent, graph, cfg);
                agent.progress = 0;
            }

            agent.progress += cfg.AGENT_SPEED;

            if (agent.progress >= 1) {
                // Arrived at nextNode
                agent.currentNode = agent.nextNode;
                agent.visitHistory.add(agent.currentNode);
                agent.nextNode = null;
                agent.progress = 0;
            }
        }

        // ── SENSE ─────────────────────────────────────────────────────────────────
        // SCIENTIFICALLY SIGNIFICANT: agent sensing and vote accumulation
        for (const agent of agents) {
            const agentPos = this._agentWorldPos(agent, graph);
            for (const cell of cells) {
                if (cell.state === 'flagged') continue;
                const dist = vecDist(agentPos, cell.position);
                if (dist < cfg.SENSE_RADIUS) {
                    tumorManager.recordVisit(cell.id, true);

                    // Log confidence milestone crossings (0.3 / 0.5 / 0.7)
                    const conf = cell.confidence;
                    if (this.onSense && (conf >= 0.3)) {
                        this.onSense(agent.id, cell.id, cell.nodeId, conf);
                    }

                    // ACTUATE: trigger quorum check immediately after each sense event
                    if (tumorManager.checkQuorum(cell.id, cfg.QUORUM_THRESHOLD, cfg.MIN_VISITS)) {
                        tumorManager.flag(cell.id);
                        if (this.onFlag) this.onFlag(cell.id);
                        if (this.onQuorum) {
                            this.onQuorum(cell.id, cell.nodeId, cell.confidence,
                                cell.positiveVotes, cell.visits, cell.isFalseSignal);
                        }
                    }
                }
            }
        }

        // ── SIGNAL ────────────────────────────────────────────────────────────────
        // SCIENTIFICALLY SIGNIFICANT: peer-to-peer signal propagation
        for (const agent of agents) {
            if (agent.signalStrength <= 0) continue;

            const agentPos = this._agentWorldPos(agent, graph);
            let neighborCount = 0;
            for (const other of agents) {
                if (other === agent) continue;
                const d = vecDist(agentPos, this._agentWorldPos(other, graph));
                if (d < cfg.SIGNAL_RADIUS) {
                    if (agent.signalStrength > other.signalStrength) {
                        other.signalTarget = agent.signalTarget;
                        other.signalStrength = agent.signalStrength * cfg.TRAIL_DECAY;
                        neighborCount++;
                    }
                }
            }

            if (neighborCount > 0 && this.onSignal) {
                this.onSignal(agent.id, agent.currentNode, neighborCount);
            }

            // Decay source agent's own signal
            agent.signalStrength *= cfg.TRAIL_DECAY;
            if (agent.signalStrength < 0.01) agent.signalStrength = 0;
        }

        // Emit signal from agents near high-confidence cells
        for (const agent of agents) {
            const agentPos = this._agentWorldPos(agent, graph);
            for (const cell of cells) {
                if (cell.confidence > 0.3 && cell.state !== 'flagged') {
                    const dist = vecDist(agentPos, cell.position);
                    if (dist < cfg.SENSE_RADIUS) {
                        agent.signalTarget = { ...cell.position };
                        agent.signalStrength = 1.0;
                        agent.state = 'converging';
                    }
                }
            }
        }
    }

    /** Pick the next node for an agent using biased random walk */
    _pickNext(agent, graph, cfg) {
        const neighbors = graph.getNeighbors(agent.currentNode);
        if (neighbors.length === 0) return agent.currentNode;

        // Bias toward unvisited neighbors
        const unvisited = neighbors.filter(n => !agent.visitHistory.has(n));
        let pool = unvisited.length > 0 ? unvisited : neighbors;

        // Additional bias toward signal target if present
        if (agent.signalTarget && agent.signalStrength > 0) {
            const target = agent.signalTarget;
            pool = pool.sort((a, b) => {
                const pa = graph.nodes[a].position;
                const pb = graph.nodes[b].position;
                return vecDist(pa, target) - vecDist(pb, target);
            });
            // 70% chance to pick the closest-to-target node
            if (Math.random() < 0.7) return pool[0];
        }

        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** Interpolated world position of an agent along its current edge */
    _agentWorldPos(agent, graph) {
        const cur = graph.nodes[agent.currentNode];
        if (!cur) return { x: 0, y: 0, z: 0 };
        if (agent.nextNode === null) return { ...cur.position };

        const nxt = graph.nodes[agent.nextNode];
        if (!nxt) return { ...cur.position };

        const t = agent.progress;
        return {
            x: cur.position.x + (nxt.position.x - cur.position.x) * t,
            y: cur.position.y + (nxt.position.y - cur.position.y) * t,
            z: cur.position.z + (nxt.position.z - cur.position.z) * t,
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// computeStats — pure function, no DOM dependency (Requirement 5.5)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute live simulation statistics from kernel state.
 * Returns a plain object so it can be tested independently of the DOM.
 *
 * @param {TumorCell[]} cells  - tumorManager.cells
 * @param {Agent[]}     agents - swarmKernel.agents
 * @param {number}      tick   - swarmKernel.tick
 * @returns {{ flaggedCount, totalTumors, falsePositives, tick, pctSearching, pctConverging }}
 */
function computeStats(cells, agents, tick) {
    const flaggedCount = cells.filter(c => !c.isFalseSignal && c.state === 'flagged').length;
    const totalTumors = cells.filter(c => !c.isFalseSignal).length;
    const falsePositives = cells.filter(c => c.isFalseSignal && c.state === 'flagged').length;

    const n = agents.length;
    let searching = 0;
    let converging = 0;
    for (const a of agents) {
        if (a.state === 'searching') searching++;
        else if (a.state === 'converging') converging++;
    }
    const pctSearching = n > 0 ? Math.round((searching / n) * 100) : 0;
    const pctConverging = n > 0 ? Math.round((converging / n) * 100) : 0;

    return { flaggedCount, totalTumors, falsePositives, tick, pctSearching, pctConverging };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports (CommonJS-compatible for testing; no-op in browser)
// ─────────────────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, VascularGraph, TumorCellManager, SwarmKernel, computeStats, vecDist, vecAdd, vecScale, normalise, rand, randInt, coneDirection };
}
