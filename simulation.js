/**
 * simulation.js — PhysioOS Three.js Scene Manager
 *
 * Responsibilities:
 *  - WebGLRenderer, PerspectiveCamera, Scene setup
 *  - Manual pointer-drag camera rotation (no OrbitControls)
 *  - Auto-rotate camera (CONFIG.AUTO_ROTATE_SPEED)
 *  - buildVesselMeshes()   — CylinderGeometry per edge (Req 1.3, 1.4, 6.1)
 *  - buildTumorMeshes()    — SphereGeometry per cell (stub, Phase 2)
 *  - buildAgentInstances() — InstancedMesh (stub, Phase 2)
 *  - updateAgentPositions()
 *  - flagTumorCell()       — color swap + pulse (stub, Phase 3)
 *  - updateTrails()        — particle trail (stub, Phase 5)
 */

class SceneManager {
    constructor() {
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.vesselGroup = null;
        this.tumorMeshes = [];     // { cellId → Mesh }
        this.agentMesh = null;   // InstancedMesh
        this.trailMesh = null;   // Points geometry for agent trails (Requirement 6.2)
        this._trailHistory = []; // ring buffer of past positions per agent
        this._trailLength = 6;
        this._trailCount = 0;
        this._animId = null;

        // Camera orbit state (manual drag, Requirement 6.3 & 7.4)
        this._theta = Math.PI / 6; // azimuth — slightly off-front for a readable angle
        this._phi = Math.PI / 3;  // polar angle — ~60° down for the "image 2" view
        this._radius = 55;         // pull back enough to see the whole network clearly
        this._drag = false;
        this._lastX = 0;
        this._lastY = 0;

        // Callbacks wired by ui.js / main loop
        this.onTick = null;       // () => void — called each animation frame
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Initialise renderer, scene, camera, lights
    // ─────────────────────────────────────────────────────────────────────────
    init(container) {
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000510, 1); // deep dark tissue background (Req 6.1)
        container.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();

        // Camera  (perspective, positioned above-ish the network)
        this.camera = new THREE.PerspectiveCamera(
            55,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this._updateCameraPosition();

        // Lighting — dim ambient + directional so emissive materials read clearly
        const ambient = new THREE.AmbientLight(0xffffff, 0.05);
        this.scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0x2050cc, 0.25);
        dirLight.position.set(20, 40, 20);
        this.scene.add(dirLight);

        // Soft fill light from below to catch vessel undersides
        const fillLight = new THREE.DirectionalLight(0x001040, 0.15);
        fillLight.position.set(-10, -20, -10);
        this.scene.add(fillLight);

        // Pointer-event camera drag (Requirement 6.3 & 7.4 — no OrbitControls)
        this._bindPointerEvents(this.renderer.domElement);

        // Resize handler
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // ── Page Visibility API — pause loop when tab is hidden (Requirement 6.5) ──
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopLoop();
            } else {
                // Only restart if a simulation tick handler is registered (i.e. swarm is deployed)
                // The idle loop (no onTick) also needs to resume so the network stays visible.
                this.startLoop();
            }
        });

        // ── WebGL context-loss / restore (Requirement 6.5) ───────────────────────
        const canvas = this.renderer.domElement;
        const overlay = document.getElementById('context-loss-overlay');

        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();             // required to allow context restore
            this.stopLoop();
            if (overlay) overlay.classList.add('visible');
        });

        canvas.addEventListener('webglcontextrestored', () => {
            if (overlay) overlay.classList.remove('visible');
            // Restart the render loop after context is restored
            this.startLoop();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Manual pointer-drag camera rotation
    // ─────────────────────────────────────────────────────────────────────────
    _bindPointerEvents(el) {
        el.addEventListener('pointerdown', (e) => {
            this._drag = true;
            this._lastX = e.clientX;
            this._lastY = e.clientY;
            el.setPointerCapture(e.pointerId);
        });

        el.addEventListener('pointermove', (e) => {
            if (!this._drag) return;
            const dx = e.clientX - this._lastX;
            const dy = e.clientY - this._lastY;
            this._lastX = e.clientX;
            this._lastY = e.clientY;

            this._theta -= dx * 0.005;
            this._phi = Math.max(0.1, Math.min(Math.PI - 0.1, this._phi + dy * 0.005));
            this._updateCameraPosition();
        });

        el.addEventListener('pointerup', () => { this._drag = false; });
        el.addEventListener('pointercancel', () => { this._drag = false; });

        // Scroll to zoom
        el.addEventListener('wheel', (e) => {
            this._radius = Math.max(10, Math.min(120, this._radius + e.deltaY * 0.05));
            this._updateCameraPosition();
        }, { passive: true });
    }

    _updateCameraPosition() {
        this.camera.position.set(
            this._radius * Math.sin(this._phi) * Math.sin(this._theta),
            this._radius * Math.cos(this._phi) + 18,
            this._radius * Math.sin(this._phi) * Math.cos(this._theta)
        );
        // Look at approximate graph centroid — taller network sits higher in Y
        this.camera.lookAt(0, 18, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vessel meshes  (Requirement 1.3, 1.4, 6.1)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Build one CylinderGeometry per graph edge and add to scene.
     * Each cylinder is oriented from the 'from' node position to the 'to' node position.
     * MeshStandardMaterial with emissive soft blue/cyan glow.
     */
    buildVesselMeshes(graph) {
        // Clear any prior vessel group
        if (this.vesselGroup) {
            this.scene.remove(this.vesselGroup);
        }
        this.vesselGroup = new THREE.Group();

        // Shared emissive material for the vascular network (Requirement 1.4, 6.1)
        // Dark base color so emissive glow is what reads, not a flat bright solid
        const vesselMat = new THREE.MeshStandardMaterial({
            color: 0x0a1a2e,
            emissive: 0x0a5fa0,
            emissiveIntensity: 0.5,
            roughness: 0.6,
            metalness: 0.1,
            transparent: true,
            opacity: 0.9,
        });

        const _tmpVec = new THREE.Vector3();
        const _tmpAxis = new THREE.Vector3();

        for (const edge of graph.edges) {
            const fromNode = graph.nodes[edge.from];
            const toNode = graph.nodes[edge.to];
            if (!fromNode || !toNode) continue;

            const from = new THREE.Vector3(fromNode.position.x, fromNode.position.y, fromNode.position.z);
            const to = new THREE.Vector3(toNode.position.x, toNode.position.y, toNode.position.z);

            const length = from.distanceTo(to);
            if (length < 1e-4) continue;

            // Radius from edge metadata (clamped to a visible minimum)
            const r = Math.max(edge.radius, 0.04);

            // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
            const geo = new THREE.CylinderGeometry(r, r, length, 6, 1);
            const mesh = new THREE.Mesh(geo, vesselMat);

            // Position cylinder at midpoint
            const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
            mesh.position.copy(mid);

            // Orient cylinder: default axis is Y; rotate to align with edge direction
            const dir = new THREE.Vector3().subVectors(to, from).normalize();
            const yAxis = new THREE.Vector3(0, 1, 0);

            if (Math.abs(dir.dot(yAxis)) < 0.9999) {
                _tmpAxis.crossVectors(yAxis, dir).normalize();
                const angle = Math.acos(Math.max(-1, Math.min(1, yAxis.dot(dir))));
                mesh.setRotationFromAxisAngle(_tmpAxis, angle);
            } else if (dir.y < 0) {
                // Pointing straight down — flip 180°
                mesh.rotation.z = Math.PI;
            }

            this.vesselGroup.add(mesh);
        }

        this.scene.add(this.vesselGroup);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tumor meshes  (Requirement 2.2)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Render each tumor cell as a red emissive sphere.
     * Both true tumors and false signal nodes look identical —
     * the swarm cannot distinguish them, only the stats panel can.
     * (Requirement 2.2, 2.4)
     */
    buildTumorMeshes(cells) {
        // Remove old tumor meshes if rebuilding
        for (const mesh of this.tumorMeshes) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
        }
        this.tumorMeshes = [];

        const tumorMat = new THREE.MeshStandardMaterial({
            color: 0xcc0000,
            emissive: 0xff1100,
            emissiveIntensity: 1.4,
            roughness: 0.3,
            metalness: 0.3,
        });

        const tumorGeo = new THREE.SphereGeometry(0.5, 10, 8);

        for (const cell of cells) {
            const mesh = new THREE.Mesh(tumorGeo, tumorMat.clone());
            mesh.position.set(cell.position.x, cell.position.y, cell.position.z);
            mesh.userData.cellId = cell.id;
            this.scene.add(mesh);
            this.tumorMeshes.push(mesh);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Agent InstancedMesh  (Requirement 3.1, 3.2, 7.1)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Create a single InstancedMesh for all agents — one draw call for up to 2000 agents.
     * (Requirement 3.2, 7.1)
     */
    buildAgentInstances(count) {
        if (this.agentMesh) {
            this.scene.remove(this.agentMesh);
            this.agentMesh.geometry.dispose();
            this.agentMesh = null;
        }

        // MeshBasicMaterial — immune to lighting, always full brightness
        // Bright yellow-green: maximum contrast against dark blue vessel network
        const geo = new THREE.SphereGeometry(0.28, 6, 5);
        const mat = new THREE.MeshBasicMaterial({ color: 0xccff00 });

        this.agentMesh = new THREE.InstancedMesh(geo, mat, count);
        this.agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Initialise all instance matrices to identity so none are at the zero-scale default
        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i++) {
            dummy.position.set(0, 0, 0);
            dummy.scale.setScalar(1);
            dummy.updateMatrix();
            this.agentMesh.setMatrixAt(i, dummy.matrix);
        }
        this.agentMesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.agentMesh);
    }

    updateAgentPositions(agents, graph) {
        if (!this.agentMesh) return;
        const dummy = new THREE.Object3D();
        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            const pos = swarmKernel._agentWorldPos(agent, graph);
            dummy.position.set(pos.x, pos.y, pos.z);
            // Converging agents render 1.7x larger so state is visually readable
            dummy.scale.setScalar(agent.state === 'converging' ? 1.7 : 1.0);
            dummy.updateMatrix();
            this.agentMesh.setMatrixAt(i, dummy.matrix);
        }
        this.agentMesh.instanceMatrix.needsUpdate = true;

        // Debug: log first agent position on every 60th frame to confirm matrix writes
        if (agents.length > 0 && this._dbgFrame === undefined) this._dbgFrame = 0;
        if (this._dbgFrame !== undefined && this._dbgFrame++ % 60 === 0) {
            const p = swarmKernel._agentWorldPos(agents[0], graph);
            console.log(`[agents] count=${agents.length} agent[0] pos=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Flagging  (Requirement 4.3, 6.4)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Called when a tumor cell reaches quorum (FLAGGED state).
     * - Swaps material color from red to gold
     * - Triggers a scale pulse animation lasting CONFIG.PULSE_DURATION_MS (≥ 500ms)
     */
    flagTumorCell(cellId) {
        const mesh = this.tumorMeshes.find(m => m.userData.cellId === cellId);
        if (!mesh) return;

        // Color swap: red → gold  (Requirement 4.3)
        mesh.material.color.setHex(0xffdd00);
        mesh.material.emissive.setHex(0xffaa00);
        mesh.material.emissiveIntensity = 1.8;

        // Pulse animation: scale up then back to 1.0  (Requirement 6.4)
        const startTime = performance.now();
        const duration = CONFIG.PULSE_DURATION_MS;
        const baseSphere = 1.0;
        const peakScale = 2.2;

        const animatePulse = (now) => {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1.0);

            // Smooth pulse: rise to peak at t=0.5, return to 1.0 at t=1.0
            const scale = baseSphere + (peakScale - baseSphere) * Math.sin(t * Math.PI);
            mesh.scale.setScalar(scale);

            if (t < 1.0) {
                requestAnimationFrame(animatePulse);
            } else {
                mesh.scale.setScalar(baseSphere);
            }
        };

        requestAnimationFrame(animatePulse);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Trails  (Requirement 6.2)
    // Secondary Points geometry that renders faded ghost positions of each agent,
    // giving the appearance of a flowing trail as agents move through the network.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Set up the trail Points geometry for `count` agents with `trailLength` history steps.
     * Must be called after buildAgentInstances().
     */
    buildTrails(count, trailLength = 6) {
        // Remove any existing trail mesh
        if (this.trailMesh) {
            this.scene.remove(this.trailMesh);
            this.trailMesh.geometry.dispose();
            this.trailMesh.material.dispose();
            this.trailMesh = null;
        }

        this._trailLength = trailLength;
        this._trailCount = count;
        const totalPoints = count * trailLength;

        // Flat Float32Arrays for positions and per-point opacity (encoded as color alpha via vertex colors)
        const positions = new Float32Array(totalPoints * 3);  // xyz per trail point
        const colors = new Float32Array(totalPoints * 3);     // rgb — used to carry opacity via brightness

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.trailMesh = new THREE.Points(geo, mat);
        this.scene.add(this.trailMesh);

        // Ring buffer: _trailHistory[agentIndex] is an array of {x,y,z} positions (newest first)
        this._trailHistory = [];
        for (let i = 0; i < count; i++) {
            this._trailHistory.push([]);
        }
    }

    /**
     * Called each frame: record each agent's current world position into the ring buffer,
     * then write faded positions into the Points geometry.
     * Opacity of each trail step decays by CONFIG.TRAIL_DECAY (oldest = most faded).
     * (Requirement 6.2)
     */
    updateTrails(agents, graph) {
        if (!this.trailMesh || !this._trailHistory) return;

        const positions = this.trailMesh.geometry.attributes.position.array;
        const colors = this.trailMesh.geometry.attributes.color.array;
        const trailLength = this._trailLength;

        // Base trail color: match agent teal/cyan hue
        const baseR = 0.0, baseG = 1.0, baseB = 0.8;

        for (let i = 0; i < agents.length && i < this._trailCount; i++) {
            const agent = agents[i];
            const pos = swarmKernel._agentWorldPos(agent, graph);

            // Push current position to front of history
            const hist = this._trailHistory[i];
            hist.unshift({ x: pos.x, y: pos.y, z: pos.z });
            if (hist.length > trailLength) hist.pop();

            // Write trail points into buffer — decay alpha via brightness
            let decay = 1.0;
            for (let t = 0; t < trailLength; t++) {
                const idx = (i * trailLength + t) * 3;
                if (t < hist.length) {
                    positions[idx] = hist[t].x;
                    positions[idx + 1] = hist[t].y;
                    positions[idx + 2] = hist[t].z;
                    // Encode fade as dimmer color (additive blending means darker = more transparent)
                    const fade = decay;
                    colors[idx] = baseR * fade;
                    colors[idx + 1] = baseG * fade;
                    colors[idx + 2] = baseB * fade;
                    decay *= CONFIG.TRAIL_DECAY;
                } else {
                    // No history yet — park point at origin with zero brightness (invisible)
                    positions[idx] = 0; positions[idx + 1] = -9999; positions[idx + 2] = 0;
                    colors[idx] = 0; colors[idx + 1] = 0; colors[idx + 2] = 0;
                }
            }
        }

        this.trailMesh.geometry.attributes.position.needsUpdate = true;
        this.trailMesh.geometry.attributes.color.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation loop
    // ─────────────────────────────────────────────────────────────────────────
    startLoop() {
        const loop = () => {
            this._animId = requestAnimationFrame(loop);

            // Auto-rotate when not dragging (Requirement 6.3)
            if (!this._drag) {
                this._theta += CONFIG.AUTO_ROTATE_SPEED;
                this._updateCameraPosition();
            }

            if (this.onTick) this.onTick();

            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }

    stopLoop() {
        if (this._animId !== null) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap — runs when page loads
// ─────────────────────────────────────────────────────────────────────────────
const sceneManager = new SceneManager();
const vascularGraph = new VascularGraph();
const tumorManager = new TumorCellManager();
const swarmKernel = new SwarmKernel();

// Callback fired when a cell reaches quorum
swarmKernel.onFlag = (cellId) => sceneManager.flagTumorCell(cellId);

(function bootstrap() {
    const container = document.getElementById('canvas-container');
    sceneManager.init(container);

    // Generate vascular network
    vascularGraph.generate(CONFIG);

    // Build vessel meshes immediately so the network is visible on load
    sceneManager.buildVesselMeshes(vascularGraph);

    // Place tumor cells
    tumorManager.place(vascularGraph, CONFIG);

    // Build tumor cell meshes
    sceneManager.buildTumorMeshes(tumorManager.cells);

    // Start idle render loop (agents start only when Deploy is clicked)
    sceneManager.startLoop();
})();
