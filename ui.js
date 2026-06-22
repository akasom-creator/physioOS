/**
 * ui.js — PhysioOS PhysioAPI Control Panel + SysLog
 *
 * Wires DOM elements to simulation callbacks.
 * Implements: deploy, recall, threshold live-update, live stats display,
 * and a real-time scrolling OS system log panel.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

// ─────────────────────────────────────────────────────────────────────────────
// SysLog — real-time scrolling OS event log panel
// ─────────────────────────────────────────────────────────────────────────────
class SysLog {
    constructor() {
        this._el = null; // resolved after DOM is ready
        this._buffer = [];
        this._MAX = 50;
        // Tracks which (agentId, cellId, tier) SENSE crossings have been logged
        this._senseSeen = new Set();
    }

    _getEl() {
        if (!this._el) this._el = document.getElementById('log-entries');
        return this._el;
    }

    _push(text, cssClass) {
        this._buffer.push({ text, cssClass });
        if (this._buffer.length > this._MAX) this._buffer.shift();
        this._render();
    }

    _render() {
        const el = this._getEl();
        if (!el) return;
        el.innerHTML = this._buffer.map(e =>
            `<div class="${e.cssClass}">${e.text}</div>`
        ).join('');
        el.scrollTop = el.scrollHeight;
    }

    clear() {
        this._buffer = [];
        this._senseSeen = new Set();
        const el = this._getEl();
        if (el) el.innerHTML = '';
    }

    system(msg) {
        this._push(msg, 'log-system');
    }

    report(flagged, total, fp, tick) {
        this._push(
            `[PhysioOS] physioOS.report() → { flagged: ${flagged}/${total}, falsePositives: ${fp}, tick: ${tick} }`,
            'log-report'
        );
    }

    /**
     * Log a SENSE confidence milestone. Only fires once per (agentId, cellId, tier).
     * Tiers: low ≥0.3, mid ≥0.5, high ≥0.7
     */
    sense(agentId, cellId, nodeId, confidence) {
        const tier = confidence >= 0.7 ? 'high' : confidence >= 0.5 ? 'mid' : 'low';
        const key = `${agentId}-${cellId}-${tier}`;
        if (this._senseSeen.has(key)) return;
        this._senseSeen.add(key);
        this._push(
            `[Agent #${agentId}] SENSE → conf ${confidence.toFixed(2)} @ node ${nodeId}`,
            'log-sense'
        );
    }

    /**
     * Log a SIGNAL broadcast. Sampled 1-in-5 to prevent flood at high agent counts.
     */
    signal(agentId, nodeId, neighborCount) {
        if (Math.random() > 0.2) return;
        this._push(
            `[Agent #${agentId}] SIGNAL → recruiting ${neighborCount} toward node ${nodeId}`,
            'log-signal'
        );
    }

    /**
     * Log a quorum ACTUATE event (flagging or false-positive warning).
     */
    quorum(cellId, nodeId, confidence, positiveVotes, visits, isFalseSignal) {
        if (isFalseSignal) {
            this._push(
                `[Swarm Kernel] WARNING → false signal @ node ${nodeId} crossed threshold (review recommended)`,
                'log-warning'
            );
        } else {
            this._push(
                `[Swarm Kernel] QUORUM REACHED → node ${nodeId} FLAGGED (conf: ${confidence.toFixed(2)}, votes: ${positiveVotes}/${visits})`,
                'log-quorum'
            );
        }
    }
}

const sysLog = new SysLog();

// ─────────────────────────────────────────────────────────────────────────────
// UIController
// ─────────────────────────────────────────────────────────────────────────────
class UIController {
    constructor() {
        this.agentSlider = document.getElementById('agent-slider');
        this.agentLabel = document.getElementById('agent-count-label');
        this.threshSlider = document.getElementById('threshold-slider');
        this.threshLabel = document.getElementById('threshold-label');
        this.deployBtn = document.getElementById('deploy-btn');
        this.recallBtn = document.getElementById('recall-btn');

        this.statFlagged = document.getElementById('stat-flagged');
        this.statTotal = document.getElementById('stat-total');
        this.statFp = document.getElementById('stat-fp');
        this.statTick = document.getElementById('stat-tick');
        this.statSearching = document.getElementById('stat-searching');
        this.statConverging = document.getElementById('stat-converging');
    }

    bind() {
        // ── Agent count slider label ─────────────────────────────────────────
        this.agentSlider.addEventListener('input', () => {
            this.agentLabel.textContent = this.agentSlider.value;
        });

        // ── Quorum threshold slider — live update, no reset (Req 5.4) ────────
        this.threshSlider.addEventListener('input', () => {
            const v = parseFloat(this.threshSlider.value);
            this.threshLabel.textContent = v.toFixed(2);
            CONFIG.QUORUM_THRESHOLD = v;
        });

        // ── Deploy Swarm (Requirement 5.2) ────────────────────────────────────
        this.deployBtn.addEventListener('click', () => {
            const agentCount = parseInt(this.agentSlider.value, 10);

            sceneManager.stopLoop();

            vascularGraph.generate(CONFIG);
            sceneManager.buildVesselMeshes(vascularGraph);

            tumorManager.place(vascularGraph, CONFIG);
            sceneManager.buildTumorMeshes(tumorManager.cells);

            swarmKernel.init(agentCount, vascularGraph);

            sceneManager.buildAgentInstances(agentCount);
            sceneManager.buildTrails(agentCount);

            // Wire log callbacks onto the kernel before starting the loop
            swarmKernel.onSense = (agentId, cellId, nodeId, confidence) =>
                sysLog.sense(agentId, cellId, nodeId, confidence);
            swarmKernel.onSignal = (agentId, nodeId, neighborCount) =>
                sysLog.signal(agentId, nodeId, neighborCount);
            swarmKernel.onQuorum = (cellId, nodeId, confidence, positiveVotes, visits, isFalseSignal) =>
                sysLog.quorum(cellId, nodeId, confidence, positiveVotes, visits, isFalseSignal);

            sceneManager.onTick = () => {
                swarmKernel.update(vascularGraph, tumorManager, CONFIG);
                sceneManager.updateAgentPositions(swarmKernel.agents, vascularGraph);
                sceneManager.updateTrails(swarmKernel.agents, vascularGraph);
                uiController.updateStats();
            };

            sceneManager.startLoop();

            sysLog.clear();
            sysLog.system(`[PhysioOS] physioOS.deploy(agentCount=${agentCount}, target='bloodstream') → OK`);

            console.log('[PhysioAPI] Deployed', agentCount, 'agents');
            if (swarmKernel.agents.length > 0) {
                const p = swarmKernel._agentWorldPos(swarmKernel.agents[0], vascularGraph);
                console.log('[PhysioAPI] agent[0] initial pos:', p);
            }
        });

        // ── Recall (Requirement 5.3) ──────────────────────────────────────────
        this.recallBtn.addEventListener('click', () => { this._recall(); });
    }

    _recall() {
        sceneManager.stopLoop();
        sceneManager.onTick = null;

        swarmKernel.agents = [];
        swarmKernel.tick = 0;
        swarmKernel.onSense = null;
        swarmKernel.onSignal = null;
        swarmKernel.onQuorum = null;

        for (const cell of tumorManager.cells) {
            cell.visits = 0;
            cell.positiveVotes = 0;
            cell.confidence = 0;
            cell.state = 'active';
        }

        sceneManager.buildTumorMeshes(tumorManager.cells);

        if (sceneManager.agentMesh) {
            sceneManager.scene.remove(sceneManager.agentMesh);
            sceneManager.agentMesh.geometry.dispose();
            sceneManager.agentMesh = null;
        }

        if (sceneManager.trailMesh) {
            sceneManager.scene.remove(sceneManager.trailMesh);
            sceneManager.trailMesh.geometry.dispose();
            sceneManager.trailMesh.material.dispose();
            sceneManager.trailMesh = null;
            sceneManager._trailHistory = [];
        }

        this.updateStats();
        sceneManager.startLoop();

        sysLog.clear();
        sysLog.system('[PhysioOS] physioOS.recall() → swarm withdrawn, state reset');
        console.log('[PhysioAPI] Recalled — simulation reset');
    }

    updateStats() {
        const cells = tumorManager.cells;
        const agents = swarmKernel.agents;
        const tick = swarmKernel.tick;

        const flaggedCount = cells.filter(c => !c.isFalseSignal && c.state === 'flagged').length;
        const totalTumors = cells.filter(c => !c.isFalseSignal).length;
        const falsePositives = cells.filter(c => c.isFalseSignal && c.state === 'flagged').length;

        const n = agents.length;
        let searching = 0, converging = 0;
        for (const a of agents) {
            if (a.state === 'searching') searching++;
            else if (a.state === 'converging') converging++;
        }
        const pctSearching = n > 0 ? Math.round((searching / n) * 100) : 0;
        const pctConverging = n > 0 ? Math.round((converging / n) * 100) : 0;

        this.statFlagged.textContent = flaggedCount;
        this.statTotal.textContent = totalTumors;
        this.statFp.textContent = falsePositives;
        this.statTick.textContent = tick;
        this.statSearching.textContent = pctSearching;
        this.statConverging.textContent = pctConverging;

        // Periodic report every 100 ticks
        if (tick > 0 && tick % 100 === 0) {
            sysLog.report(flaggedCount, totalTumors, falsePositives, tick);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
const uiController = new UIController();
uiController.bind();
