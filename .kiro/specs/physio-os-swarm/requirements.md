# Requirements Document

## Introduction

PhysioOS Simulator is a web-based interactive prototype demonstrating an "operating system for programmable biology." The system simulates a swarm of nanobot agents navigating a procedurally generated 3D vascular network to autonomously locate and flag tumor cells using distributed quorum consensus. The simulation runs entirely client-side in a single browser page using Three.js for 3D rendering, with no backend required.

## Glossary

- **Agent**: A simulated nanobot particle that traverses the vascular network, senses tumor cells, and participates in consensus signaling.
- **Vascular Network**: A procedurally generated 3D branching graph representing a simplified capillary system; nodes are junctions, edges are vessel segments.
- **Tumor Cell**: A simulated target marker placed at leaf nodes or deep vessel segments; has a `confidence` property updated by agent sensing.
- **Quorum Threshold**: The minimum ratio of positive votes to visits required for a tumor cell to be marked as FLAGGED.
- **FLAGGED**: The state of a tumor cell that has reached the quorum consensus threshold and minimum visit count.
- **False Signal Node**: A non-tumor node seeded to simulate false positives in the consensus protocol.
- **HAL (Hardware Abstraction Layer)**: The four agent behaviors: MOVE, SENSE, SIGNAL, ACTUATE.
- **PhysioAPI**: The UI control panel that exposes simulation parameters to the user.
- **Swarm Kernel**: The consensus layer that tracks per-tumor-cell vote state and applies the quorum logic.
- **InstancedMesh**: A Three.js rendering technique that renders many identical objects in a single draw call for performance.
- **Tick**: A single simulation step (frame update cycle).
- **Biased Random Walk**: A pathfinding strategy where agents favor unexplored branches or branches near a sensed gradient.
- **Murray's Law**: A biological principle governing vessel branching ratios, used as inspiration for network generation.
- **Quorum**: Consensus reached when `positiveVotes / visits >= QUORUM_THRESHOLD` AND `visits >= MIN_VISITS`.

---

## Requirements

### Requirement 1

**User Story:** As a hackathon judge, I want to see a procedurally generated 3D vascular network rendered in the browser, so that I can understand the environment the nanobot swarm navigates.

#### Acceptance Criteria

1. WHEN the page loads, THE Simulator SHALL procedurally generate a branching 3D vascular network using a recursive branching algorithm with 4–6 levels of depth.
2. WHEN generating the network, THE Simulator SHALL split each branch into 2–3 children with decreasing radius and length at each depth level, inspired by Murray's Law.
3. WHEN rendering the network, THE Simulator SHALL represent each vessel segment as a Three.js CylinderGeometry connected at branch junction nodes.
4. WHEN rendering the network, THE Simulator SHALL apply emissive materials to vessel segments to produce a soft glow effect against a dark background.
5. THE Simulator SHALL store the vascular network as a graph data structure where nodes represent junctions and edges represent vessel segments, enabling agent pathfinding.

---

### Requirement 2

**User Story:** As a hackathon judge, I want to see tumor cell targets placed within the network, so that I can observe the swarm's targeting behavior.

#### Acceptance Criteria

1. WHEN the simulation initializes, THE Simulator SHALL randomly place 30–50 tumor cell markers at leaf nodes or deep vessel segment positions within the vascular network.
2. WHEN rendering tumor cells, THE Simulator SHALL display each tumor cell as a red sphere with a visually distinct marker (color or glow) indicating its HER2+ status.
3. THE Simulator SHALL assign each tumor cell an initial `confidence` value of 0 that increases as agents sense it.
4. THE Simulator SHALL seed 3–5 false signal nodes that mimic tumor cell appearance but are not true tumor targets, enabling false positive tracking.

---

### Requirement 3

**User Story:** As a hackathon judge, I want to see a swarm of nanobot agents navigating the vascular network, so that I can observe emergent distributed behavior.

#### Acceptance Criteria

1. WHEN the user clicks "Deploy Swarm," THE Simulator SHALL spawn between 200 and 2000 agent particles at the root node of the vascular network.
2. THE Simulator SHALL render all agents using Three.js InstancedMesh or Points geometry so that up to 2000 agents render in a single draw call.
3. WHEN traversing the network, each Agent SHALL implement a biased random walk with preference toward unexplored branches or branches with a detected chemical gradient.
4. WHEN an agent is within the sense radius of a tumor cell, THE Agent SHALL execute the SENSE behavior and increment that tumor cell's `confidence` and visit count.
5. WHEN an agent's SENSE behavior detects a tumor cell above a local confidence threshold, THE Agent SHALL execute the SIGNAL behavior by broadcasting its location to neighboring agents within a defined radius.
6. WHEN neighboring agents receive a SIGNAL, THE Agent SHALL bias its MOVE direction toward the signaled location.
7. WHEN a tumor cell's quorum condition is met, THE Agent SHALL execute the ACTUATE behavior and mark that cell as FLAGGED.

---

### Requirement 4

**User Story:** As a hackathon judge, I want to understand the consensus protocol, so that I can evaluate the scientific validity of the PhysioOS approach.

#### Acceptance Criteria

1. THE Swarm Kernel SHALL track a `{visits, positiveVotes}` record for each tumor cell updated every tick an agent is within sense radius.
2. WHEN `positiveVotes / visits >= QUORUM_THRESHOLD` AND `visits >= MIN_VISITS`, THE Swarm Kernel SHALL transition the tumor cell state to FLAGGED.
3. WHEN a tumor cell is FLAGGED, THE Simulator SHALL change its rendered color from red to green/gold and trigger a brief pulse animation at that node.
4. THE Simulator SHALL expose `QUORUM_THRESHOLD` as a UI slider adjustable from 0.5 to 1.0 (default 0.85), demonstrating the precision/recall tradeoff.
5. THE Simulator SHALL track a false positive count by applying the same quorum logic to false signal nodes and incrementing the count when any false signal node reaches FLAGGED state.

---

### Requirement 5

**User Story:** As a simulation operator, I want a control panel (PhysioAPI), so that I can configure and control the simulation in real time.

#### Acceptance Criteria

1. THE Simulator SHALL display a PhysioAPI control panel containing: a deploy slider (200–2000 agents), a quorum threshold slider (0.5–1.0), a biomarker target dropdown, a recall button, and a report stats panel.
2. WHEN the user adjusts the deploy slider and clicks "Deploy Swarm," THE Simulator SHALL spawn the specified number of agents and start the simulation loop.
3. WHEN the user clicks "Recall," THE Simulator SHALL stop the simulation loop and reset all agent, tumor cell, and consensus state to initial values.
4. WHEN the user adjusts the quorum threshold slider, THE Simulator SHALL apply the new threshold value to the Swarm Kernel on the next tick without requiring a full reset.
5. THE Simulator SHALL display a live stats report showing: tumor cells flagged vs. total, current tick count, false positive count, and agent distribution (percentage searching vs. converged).

---

### Requirement 6

**User Story:** As a hackathon attendee, I want the simulation to be visually polished and performant, so that I can be impressed by the demo.

#### Acceptance Criteria

1. THE Simulator SHALL render on a dark background with the vascular network using emissive Three.js materials to suggest a tissue/bloodstream environment.
2. WHEN agents move, THE Simulator SHALL render a subtle trailing visual effect to convey swarm flow.
3. THE Simulator SHALL auto-rotate the camera slowly by default and SHALL allow the user to override camera rotation via mouse drag.
4. WHEN a tumor cell transitions to FLAGGED, THE Simulator SHALL trigger a brief pulse or glow animation at that node lasting at least 500 milliseconds.
5. THE Simulator SHALL maintain a frame rate of 30 fps or higher with up to 2000 agents active on a standard desktop browser.
6. THE Simulator SHALL display a title overlay reading "PhysioOS — Swarm Simulation Environment" with the subtitle "Distributed nanoscale agents navigating a vascular network under quorum consensus."

---

### Requirement 7

**User Story:** As a developer or judge inspecting the code, I want the simulation to be well-structured and tunable, so that I can understand and extend it.

#### Acceptance Criteria

1. THE Simulator SHALL define all key constants (agent count, quorum threshold, tumor cell count, branching depth, sense radius, signal radius) in a single clearly labeled configuration block at the top of the main source file.
2. THE Simulator SHALL be delivered as a single self-contained HTML file or a clean 3–4 file structure (index.html, simulation.js, kernel.js, ui.js).
3. THE Simulator SHALL include inline code comments on all consensus and quorum logic, identifying each section as scientifically significant.
4. THE Simulator SHALL use only Three.js r128-compatible APIs: SphereGeometry, CylinderGeometry, and manual camera rotation — no OrbitControls import or CapsuleGeometry.
