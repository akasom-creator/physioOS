# Implementation Plan

> Sequencing principle: a visually working, demoable simulation exists as early as possible. Property-based tests are placed as close to their related implementation tasks as possible per spec workflow, but are marked optional so the demo is never blocked by them.

---

- [x] 1. Phase 1 — Visible skeleton





  - [x] 1.1 Set up index.html with Three.js r128 from CDN, empty dark-background scene, and manual mouse-drag camera rotation (no OrbitControls import)


    - Create the root HTML file with Three.js CDN script tag
    - Set up a basic WebGLRenderer, PerspectiveCamera, and Scene
    - Implement pointer-event-based camera drag rotation as a replacement for OrbitControls
    - Add slow auto-rotate in the animation loop (CONFIG.AUTO_ROTATE_SPEED)
    - _Requirements: 6.3, 7.2, 7.4_

  - [x] 1.2 Implement VascularGraph.generate() in kernel.js


    - Recursive branching algorithm: each node spawns 2–3 children at randomized angles within a ~60° cone
    - Apply Murray's Law radius falloff: `childRadius = parentRadius × (1 / BRANCH_FACTOR^(1/3))`
    - Reduce length by factor 0.7 + small jitter at each depth level
    - Cap total nodes at MAX_NODES (~400); stop recursion when cap is reached or depth >= BRANCH_DEPTH
    - Store output as `{ nodes: Node[], edges: Edge[], leafNodes: id[] }` graph structure
    - Define all constants in CONFIG block at top of file
    - _Requirements: 1.1, 1.2, 1.5, 7.1_

  - [ ]* 1.3 Write property test for branching invariant
    - **Property 9: Branching radius/length invariant**
    - **Validates: Requirements 1.2**
    - For randomly generated graphs (varied depth 4–6, branchFactor 2–3), assert every edge has childRadius < parentRadius and childLength < parentLength

  - [x] 1.4 Implement SceneManager.buildVesselMeshes() in simulation.js


    - For each edge in the graph, create a CylinderGeometry sized to edge radius and length
    - Position and orient each cylinder between its two endpoint node positions
    - Apply MeshStandardMaterial with emissive color (soft blue/cyan glow) and low ambient
    - Add all vessel meshes to the Three.js scene
    - _Requirements: 1.3, 1.4, 6.1_

  - [x] 1.5 Checkpoint — Confirm vascular network renders correctly

    - Ensure all tests pass, ask the user if questions arise.

- [x] 2. Phase 2 — Targets and agents visible and moving





  - [x] 2.1 Implement TumorCellManager.place() in kernel.js

    - Randomly select 30–50 leaf or deep (depth >= BRANCH_DEPTH - 1) nodes for tumor placement
    - Seed 3–5 false signal nodes from the remaining eligible node pool
    - Initialize each TumorCell with `{ visits: 0, positiveVotes: 0, confidence: 0, state: 'active', isFalseSignal }`
    - Clamp tumor count to available leaf node count if needed
    - _Requirements: 2.1, 2.3, 2.4, 4.1_

  - [x] 2.2 Implement SceneManager.buildTumorMeshes() in simulation.js


    - Render each tumor cell as a SphereGeometry with red emissive material
    - Render false signal nodes with identical appearance (indistinguishable to swarm, visually distinct only in stats)
    - _Requirements: 2.2_

  - [x] 2.3 Implement Agent state objects and SceneManager.buildAgentInstances() in simulation.js


    - Create N lightweight agent state objects `{ id, currentNode, nextNode, progress, state, visitHistory, signalTarget, signalStrength }`
    - Build a single THREE.InstancedMesh (SphereGeometry, small radius) for all agents in one draw call
    - _Requirements: 3.1, 3.2, 7.1_

  - [x] 2.4 Implement MOVE behavior in SwarmKernel.tick()

    - Each tick, advance agent `progress` toward `nextNode` by CONFIG.AGENT_SPEED
    - On arrival (progress >= 1), choose next node: prefer unvisited neighbors (biased random walk); fall back to parent if dead-end
    - Update agent's `visitHistory` set and interpolated world position
    - Write updated position matrix to InstancedMesh for each agent
    - _Requirements: 3.3, 3.7_

  - [x] 2.5 Wire "Deploy Swarm" button to spawn agents and start the requestAnimationFrame render loop


    - Read agent count from slider, call SwarmKernel.init(), start loop
    - _Requirements: 5.2_

  - [x] 2.6 Write property test for agent count invariant











    - **Property 4: Agent count invariant**
    - **Validates: Requirements 3.1**
    - For any N in [200, 2000], after deploying and running N ticks, assert agents.length === N


  - [x] 2.7 Write property test for agent graph confinement












    - **Property 7: Agent graph confinement**
    - **Validates: Requirements 3.3**
    - For any tick count, assert every agent's currentNode is a valid node ID in the graph

  - [x] 2.8 Checkpoint — Deploy 500 agents, confirm they flow through vasculature at 30+ fps

    - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Phase 3 — Consensus logic working end-to-end





  - [x] 3.1 Implement SENSE behavior in SwarmKernel.tick()


    - Each tick, for each agent, check Euclidean distance to all tumor cells
    - If distance < CONFIG.SENSE_RADIUS, call `tumorManager.recordVisit(cellId, vote=true)`
    - Update cell's `confidence = positiveVotes / visits`
    - _Requirements: 3.4, 4.1_

  - [x] 3.2 Write property test for vote bound invariant






    - **Property 5: Vote bound invariant**
    - **Validates: Requirements 4.1**
    - Generate arbitrary sequences of recordVisit() calls; assert positiveVotes <= visits always holds

  - [x] 3.3 Implement quorum check (checkQuorum) and ACTUATE in SwarmKernel.tick()


    - After each SENSE pass, call `checkQuorum(cellId, CONFIG.QUORUM_THRESHOLD, CONFIG.MIN_VISITS)`
    - Transition cell to 'flagged' state when both conditions met; state is irreversible
    - Call SceneManager.flagTumorCell(cellId) to trigger visual change
    - _Requirements: 4.2, 3.7_

  - [x] 3.4 Write property test for quorum gate






    - **Property 1: Quorum gate — no premature flagging**
    - **Validates: Requirements 4.2**
    - Generate arbitrary {visits, positiveVotes, threshold, minVisits} tuples; assert FLAGGED iff both gate conditions hold

  - [x] 3.5 Write property test for quorum monotonicity






    - **Property 2: Quorum monotonicity**
    - **Validates: Requirements 4.2**
    - Apply arbitrary additional vote sequences to a FLAGGED cell; assert state remains 'flagged'

  - [x] 3.6 Implement SceneManager.flagTumorCell() — color swap and pulse animation


    - Swap material color from red to gold/green
    - Animate scale pulse (scale up then back to 1.0) over CONFIG.PULSE_DURATION_MS >= 500ms
    - _Requirements: 4.3, 6.4_

  - [x] 3.7 Implement SIGNAL behavior in SwarmKernel.tick()


    - When an agent's most recently sensed cell has confidence > 0.3 (early signal threshold), emit signal
    - Iterate all other agents; if within CONFIG.SIGNAL_RADIUS, set their `signalTarget` and `signalStrength`
    - MOVE bias: when signalStrength > 0, weight neighbor selection toward the signalTarget position; decay signalStrength each tick by TRAIL_DECAY
    - _Requirements: 3.5, 3.6_

  - [x] 3.8 Write property test for signal propagation






    - **Property 10: Signal propagation to neighbors**
    - **Validates: Requirements 3.5, 3.6**
    - Place agents within SIGNAL_RADIUS of a signaling agent; after one tick assert their signalTarget is non-null

  - [x] 3.9 Checkpoint — Run full deploy, watch agents converge on and flag tumor cells



    - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Phase 4 — PhysioAPI control panel and stats







  - [x] 4.1 Build control panel DOM in ui.js
    - Deploy slider (200–2000), "Deploy Swarm" button, quorum threshold slider (0.5–1.0)
    - Biomarker target dropdown (cosmetic: HER2+, PD-L1+, EGFR+)
    - "Recall" button
    - Report stats panel (flagged/total, tick, false positives, % searching vs converged)
    - _Requirements: 5.1_


  - [x] 4.2 Wire threshold slider to live CONFIG.QUORUM_THRESHOLD update (no reset required)
    - On slider input event, update CONFIG.QUORUM_THRESHOLD; kernel reads new value on next tick
    - _Requirements: 5.4_

  - [x]* 4.3 Write property test for threshold slider immediacy


    - **Property 6: Threshold slider immediacy**
    - **Validates: Requirements 5.4**
    - Set threshold to an arbitrary value; assert kernel uses that value on the next tick call

  - [x] 4.4 Implement Recall — stop loop, reset all state

    - Cancel requestAnimationFrame, reset all agent objects, reset all tumor cell visits/votes/state to initial values
    - _Requirements: 5.3_


  - [x] 4.5 Implement live stats panel update in UIController.updateStats()
    - Compute: flaggedCount, totalTumors, currentTick, falsePositiveCount (FLAGGED false signal nodes), % searching (state === 'searching'), % converging
    - Update DOM each tick
    - _Requirements: 5.5_


  - [ ]* 4.6 Write property test for stats consistency
    - **Property 8: Stats consistency**
    - **Validates: Requirements 5.5**
    - For arbitrary kernel state, assert reported flaggedCount === cells.filter(c => c.state==='flagged').length, and falsePositiveCount === falseSignalNodes.filter(flagged).length



  - [ ]* 4.7 Write property test for false positive isolation
    - **Property 3: False positive isolation**
    - **Validates: Requirements 4.5**
    - Run kernel on mixed cell set; assert false positive count includes only false-signal nodes in FLAGGED state, never true tumor cells

  - [x] 4.8 Add title overlay text in index.html

    - "PhysioOS — Swarm Simulation Environment" + subtitle "Distributed nanoscale agents navigating a vascular network under quorum consensus"
    - _Requirements: 6.6_


  - [x] 4.9 Checkpoint — Full demo loop: deploy → converge → adjust threshold → recall → redeploy
    - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Phase 5 — Visual polish






  - [x] 5.1 Add agent trailing effect using a secondary Points geometry with TRAIL_DECAY opacity

    - _Requirements: 6.2_

  - [x] 5.2 Tune emissive material intensity, vessel glow, dark background, and overall visual appeal


    - _Requirements: 6.1_

  - [x] 5.3 Add browser visibility API handler (pause loop on tab hide) and WebGL context-loss error overlay


    - _Requirements: 6.5_

  - [x] 5.4 Final Checkpoint — Verify 30+ fps at 2000 agents; confirm full demo loop is visually polished


    - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Phase 6 — Property-based test suite (stretch goal)






  - [x] 6.1 Set up physio-os-swarm.test.js with fast-check; ensure kernel.js is importable independent of Three.js/browser

    - _Requirements: 7.2_

  - [x] 6.2 Run all property-based tests (P1–P10) and confirm 100+ iterations each pass






    - Ensure all tests pass, ask the user if questions arise.
