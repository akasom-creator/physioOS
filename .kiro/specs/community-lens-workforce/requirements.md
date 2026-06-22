# Requirements Document

## Introduction

Community Lens Workforce Network is an AI-powered digital opportunity platform that connects underserved individuals with verified work opportunities, skill development, and community resources. The platform replaces traditional CV-based hiring with AI assessment, real task verification, reputation scoring, and escrow-protected payments to create a trusted digital work economy. Workers build professional identities through proven ability, not background or connections.

## Glossary

- **Worker**: An individual seeking work opportunities on the platform, who builds reputation through verified task completion.
- **Client**: A company, startup, or organization posting jobs and hiring Workers through the platform.
- **Trust Score**: A numerical score (0–100) assigned to Workers and Clients reflecting reliability, quality, and behavior history.
- **Skill Score**: A numerical score (0–100) assigned to a Worker for a specific skill, derived from AI-evaluated assessments and completed tasks.
- **Skill Level**: A categorical rank (Level 0–4) assigned to a Worker per skill, derived from the Skill Score.
- **Digital Work Passport**: A verified Worker profile containing confirmed skills, Trust Score, job history, and portfolio.
- **Escrow**: A payment holding mechanism where Client funds are locked before work begins and released upon milestone approval.
- **Milestone**: A defined deliverable within a Contract, tied to a payment release.
- **Contract**: A formal agreement between a Worker and Client for a specific job, containing milestones and payment terms.
- **Assessment**: A skill evaluation task assigned to a Worker by the AI system to determine Skill Score and Skill Level.
- **AI Service**: The platform's artificial intelligence component responsible for onboarding analysis, job matching, skill evaluation, and career guidance.
- **Match Score**: A percentage (0–100%) representing how well a Worker's profile aligns with a job posting.
- **Community Resource**: External support services (training, healthcare, food assistance, local opportunities) surfaced by the platform.
- **Pro Membership**: A paid subscription tier for Workers or Clients that unlocks advanced platform features.
- **Platform Fee**: A percentage of the job value deducted by the platform upon payment release.
- **Groq AI**: The third-party AI inference provider used by the AI Service, accessed via the GROQ_API_KEY environment variable using the llama3-8b-8192 model.
- **OPay**: The primary payment provider used for escrow deposits and Worker payouts, accessed via OPAY_PUBLIC_KEY and OPAY_SECRET_KEY.
- **API Gateway**: A single entry-point service (port 3001) that routes requests to internal microservices and enforces authentication.

---

## Requirements

### Requirement 1: AI-Powered Onboarding

**User Story:** As a new Worker, I want the platform to analyze my stated background and generate a skill profile, so that I can start building my professional identity without needing a formal CV.

#### Acceptance Criteria

1. WHEN a new Worker submits an onboarding description of their background, skills, and goals, THE AI Service SHALL extract skill categories, estimated experience levels, location, and recommended learning paths to populate an initial profile.
2. WHEN the AI Service generates an initial profile, THE system SHALL present the Worker with the extracted information for review before saving.
3. WHEN onboarding is complete, THE system SHALL assign the Worker a Skill Level of 0 for all unverified skills until an Assessment is completed.
4. IF the AI Service cannot confidently extract a skill category from the Worker's input, THEN THE system SHALL prompt the Worker to select from a predefined skill category list.
5. WHEN a new Client registers, THE system SHALL collect company name, industry, size, and payment method before granting access to job posting features.

---

### Requirement 2: Skill Assessment and Verification

**User Story:** As a Worker, I want my skills to be verified through real task-based assessments, so that my profile reflects proven ability rather than self-reported claims.

#### Acceptance Criteria

1. WHEN a Worker requests skill verification for a skill category, THE AI Service SHALL generate an Assessment task appropriate to that skill and the Worker's current estimated level.
2. WHEN a Worker submits Assessment work, THE AI Service SHALL evaluate the submission against defined quality criteria and produce a Skill Score between 0 and 100.
3. WHEN the AI Service produces a Skill Score, THE system SHALL assign a Skill Level according to the following mapping: 0–20 = Level 0, 21–40 = Level 1, 41–60 = Level 2, 61–80 = Level 3, 81–100 = Level 4.
4. WHEN a Worker completes a verified job Contract, THE system SHALL factor the job outcome into the Worker's Skill Score for the relevant skill category.
5. IF a Worker's Skill Score increases such that it crosses a Skill Level boundary, THEN THE system SHALL update the Worker's Skill Level and notify the Worker.
6. THE system SHALL prevent Workers from self-assigning or manually editing their Skill Score or Skill Level.

---

### Requirement 3: Job Posting and AI Matching

**User Story:** As a Client, I want to post job requirements and receive AI-matched Worker recommendations, so that I can hire verified talent efficiently.

#### Acceptance Criteria

1. WHEN a Client submits a job posting with required skill categories, duration, and budget, THE system SHALL store the job and trigger the AI Service to compute Match Scores against eligible Workers.
2. WHEN the AI Service computes Match Scores, THE system SHALL rank Workers by Match Score and present the top matches to the Client.
3. WHEN computing a Match Score, THE AI Service SHALL consider the Worker's Skill Score for required skills, Trust Score, availability status, and past work history.
4. WHEN a Client selects a Worker and the Worker accepts, THE system SHALL create a Contract with defined Milestones and lock the Client's payment in Escrow.
5. IF a job posting budget is below the minimum platform threshold, THEN THE system SHALL reject the posting and notify the Client of the minimum allowed value.
6. WHILE a Contract is active, THE system SHALL prevent the Client from withdrawing Escrow funds without initiating a dispute.

---

### Requirement 4: Escrow Payment System

**User Story:** As a Worker, I want payments to be held in escrow and released upon milestone approval, so that I can trust I will be compensated for completed work.

#### Acceptance Criteria

1. WHEN a Contract is created, THE Payment Service SHALL lock the full Contract value in Escrow before any work begins.
2. WHEN a Worker marks a Milestone as complete and submits deliverables, THE system SHALL notify the Client and begin a review period.
3. WHEN a Client approves a Milestone, THE Payment Service SHALL release the Milestone payment to the Worker minus the Platform Fee.
4. IF a Client does not respond to a Milestone completion within the defined review period, THEN THE system SHALL automatically approve the Milestone and release payment.
5. WHEN a payment is released, THE system SHALL record the transaction with timestamp, amount, Platform Fee deducted, and parties involved.
6. THE Payment Service SHALL support OPay as the primary payment provider for all escrow deposits and Worker payouts, using the OPAY_PUBLIC_KEY and OPAY_SECRET_KEY environment variables and defaulting to NGN currency.

---

### Requirement 5: Trust Score System

**User Story:** As a platform participant, I want Workers and Clients to have publicly visible Trust Scores, so that all parties can make informed decisions based on verified track records.

#### Acceptance Criteria

1. WHEN a Contract is completed, THE Trust Service SHALL update the Worker's Trust Score based on completion rate, quality rating, on-time delivery, and communication score from the Client.
2. WHEN a Contract is completed, THE Trust Service SHALL update the Client's Trust Score based on payment reliability, fairness rating, and communication score from the Worker.
3. WHEN a dispute is resolved against a party, THE Trust Service SHALL apply a negative adjustment to that party's Trust Score.
4. THE system SHALL display a Worker's Trust Score, job completion count, on-time percentage, and average rating on the Worker's Digital Work Passport.
5. WHILE a Worker's Trust Score is below 40, THE system SHALL restrict the Worker from applying to jobs above Level 2 requirements.
6. THE Trust Service SHALL recalculate Trust Scores after every completed or disputed Contract.

---

### Requirement 6: Digital Work Passport

**User Story:** As a Worker, I want a verified digital profile that showcases my skills, history, and reputation, so that I can present trusted credentials to Clients without a traditional CV.

#### Acceptance Criteria

1. THE system SHALL generate a Digital Work Passport for every Worker upon registration, containing the Worker's verified skills, Skill Levels, Trust Score, completed job count, and portfolio items.
2. WHEN a Worker completes a Contract, THE system SHALL add the verified job to the Worker's Digital Work Passport with skill tags, Client rating, and completion date.
3. WHEN a Worker completes an Assessment, THE system SHALL add the verified skill and Skill Score to the Digital Work Passport.
4. THE system SHALL expose the Digital Work Passport via a shareable public URL containing only verified information.
5. IF a Client views a Worker's Digital Work Passport, THEN THE system SHALL log the view event for analytics without exposing viewer identity to the Worker.

---

### Requirement 7: Community Resource Layer

**User Story:** As a Worker facing hardship, I want the platform to surface relevant community support resources, so that I can access help while transitioning into stable income.

#### Acceptance Criteria

1. WHEN a Worker's message or profile update indicates financial hardship or job loss, THE AI Service SHALL identify and surface relevant Community Resources including training programs, food support, healthcare, and local opportunities.
2. WHEN Community Resources are displayed, THE system SHALL filter results by the Worker's registered location.
3. THE system SHALL allow platform administrators to add, update, and remove Community Resource entries.
4. WHEN a Worker interacts with a Community Resource link, THE system SHALL log the interaction for platform improvement without sharing personal data externally.

---

### Requirement 8: Pro Membership

**User Story:** As a Worker or Client, I want access to a premium membership tier, so that I can unlock advanced features that improve my outcomes on the platform.

#### Acceptance Criteria

1. WHERE a Worker has an active Pro Membership, THE system SHALL provide access to AI career coaching, advanced portfolio analytics, learning path recommendations, and portfolio customization features.
2. WHERE a Client has an active Pro Membership, THE system SHALL provide access to additional job posting slots, advanced Worker search filters, workforce analytics, and priority AI matching.
3. THE system SHALL prevent Pro Membership from granting any increase to a Worker's Skill Score or Skill Level.
4. WHEN a Pro Membership subscription lapses, THE system SHALL revert the user's access to standard tier features without deleting their data.
5. WHEN a user purchases a Pro Membership, THE Payment Service SHALL process the subscription charge and activate the membership within 60 seconds of payment confirmation.

---

### Requirement 9: Dispute Resolution

**User Story:** As a Worker or Client, I want a structured dispute process, so that conflicts over deliverables or payments are resolved fairly.

#### Acceptance Criteria

1. WHEN a Client rejects a Milestone submission, THE system SHALL allow the Worker to raise a dispute within 48 hours of rejection.
2. WHEN a dispute is raised, THE system SHALL notify both parties and assign the dispute to a platform moderator for review.
3. WHEN a moderator resolves a dispute, THE system SHALL release Escrow funds according to the resolution outcome and update both parties' Trust Scores accordingly.
4. THE system SHALL maintain an immutable audit log of all dispute events including timestamps, submitted evidence, and resolution decisions.
5. IF a Client or Worker accumulates 3 unresolved disputes within a 90-day period, THEN THE system SHALL flag the account for administrative review.

---

### Requirement 10: Platform Security and Data Integrity

**User Story:** As a platform user, I want my identity, payments, and data to be protected, so that I can operate safely in the digital work economy.

#### Acceptance Criteria

1. THE system SHALL verify Worker identity using government-issued ID or equivalent document upload before the Worker can apply to Level 2 or higher jobs.
2. THE system SHALL encrypt all payment transaction data in transit and at rest.
3. THE system SHALL maintain audit trails for all Trust Score changes, payment events, and Contract state transitions.
4. WHEN suspicious activity is detected on an account, THE system SHALL temporarily suspend the account and notify the account holder and platform administrators.
5. THE system SHALL store uploaded files including portfolios, certificates, and identity documents using Supabase Storage with access controls enforced at the API layer.
