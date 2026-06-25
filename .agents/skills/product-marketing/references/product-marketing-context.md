# Product Marketing Context

This reference governs the creation and maintenance of `.agents/product-marketing-context.md` — a single foundational document that captures product positioning, messaging, and buyer context so every downstream marketing task can reference it without re-gathering the same information.

---

## When to Create or Update This Document

Create it when:
- Starting a new product marketing initiative
- Preparing for a launch, campaign, or go-to-market motion
- Onboarding a new stakeholder who needs product context fast
- The current copy, positioning, or messaging feels inconsistent

Update it when:
- A significant new ICP segment is validated
- Competitive landscape shifts materially
- Customer language from interviews diverges from current copy
- A new pricing tier or business model is introduced

---

## Workflow

### Step 1 — Check for Existing Context

Look for an existing context file at:
- `.agents/product-marketing-context.md` (current)
- `.claude/product-marketing-context.md` (legacy)

If found, present it, identify stale or missing sections, and offer to update selectively.

### Step 2 — Choose a Path

**Path A — Auto-Draft (recommended)**

Analyze available materials to generate an initial draft:
- `README.md` — product description and key benefits
- Landing page copy — headline, subhead, feature callouts, testimonials
- `package.json` or `pyproject.toml` — category signals from keywords and description
- Existing docs, blog posts, or sales decks — customer language and positioning signals

Generate a complete draft from these sources, clearly marking inferred sections with `[INFERRED — please validate]`.

**Path B — Conversational Gathering**

Walk through each section one at a time. Ask specific questions rather than open-ended ones. Request examples — they unlock far better answers than abstract descriptions.

Example: instead of "describe your target audience", ask "who was the last person to buy this, and what was their title and company type?"

### Step 3 — Iterate

For each section, validate before moving on. Flag gaps explicitly rather than filling them with generic placeholder text.

### Step 4 — Save and Confirm

Write the final document to `.agents/product-marketing-context.md`. Communicate that all future marketing tasks will reference this file automatically — updating it here updates the context for all downstream work.

---

## The 12-Section Framework

### 1. Product Overview

```
One-liner: [Single sentence — what it does and who it's for]
Description: [2–3 sentence product description]
Category: [e.g., developer tools, SaaS, marketplace, infrastructure]
Product type: [software / platform / API / physical / service]
Business model: [freemium / subscription / usage-based / transactional / services]
```

### 2. Target Audience

```
Company type: [e.g., B2B SaaS, e-commerce brands, fintech startups]
Company size: [SMB / mid-market / enterprise or headcount range]
Geography: [primary markets]
Decision-makers: [titles and roles involved in the buying process]
Primary use case: [the core workflow or problem this solves]
Jobs-to-be-done: [list 2–4 JTBD statements — "When I [situation], I want to [motivation], so I can [outcome]"]
```

### 3. Personas (B2B)

Define each role in the buying process separately. Skip roles that don't apply.

```
User Persona
  Name/title: [who uses the product day-to-day]
  Primary goal: [what they're trying to accomplish]
  Frustrations: [what slows them down or fails them today]

Champion Persona
  Name/title: [who advocates internally for the purchase]
  Motivation: [why they care — career impact, team impact, mission]
  Objections they face: [what they have to overcome internally]

Decision Maker
  Name/title: [who signs off]
  Success criteria: [how they evaluate the decision]
  Risk concern: [what could make them say no]

Financial Buyer
  Name/title: [who controls budget]
  Framing preference: [ROI / cost reduction / risk mitigation / growth]

Technical Influencer
  Name/title: [who evaluates integration and security]
  Key concerns: [security, compliance, implementation effort, support]
```

For B2C products: replace with a single persona — demographics, psychographics, trigger moment, and desired transformation.

### 4. Problems and Pain Points

```
Core challenge: [The primary problem in one sentence]
Current solution gaps: [How do they solve it today, and where does that fall short?]
Cost of the problem: [What does it cost them — time, money, missed opportunity, emotional drain?]
Emotional tension: [What do they feel — frustrated, embarrassed, overwhelmed, anxious?]
Urgency drivers: [What makes them actively look for a solution now vs. later?]
```

### 5. Competitive Landscape

```
Direct competitors: [Products solving the same problem in the same way]
  - [Name]: [Their positioning and where they fall short]

Secondary competitors: [Different approach to the same problem]
  - [Name]: [Their approach and limitation]

Indirect competitors: [Status quo — spreadsheets, manual process, doing nothing]
  - [Name]: [Why customers stay with this today]

Category perception: [How does the market categorize this type of product?]
Competitor messaging patterns: [Common claims in the space — what everyone says]
```

### 6. Differentiation

```
Key differentiators: [What is genuinely different — not just better, but different]
  1. [Differentiator — describe the mechanism, not just the outcome]
  2.
  3.

Implementation approach: [What makes the product work differently under the hood]
Key benefits: [Outcomes customers get that competitors can't match]
Selection reasons: [The 2–3 reasons a customer chooses this over alternatives]
Category frame: [How should this be positioned — new category, redefined category, or challenger?]
```

### 7. Objections and Anti-Personas

```
Top objections:
  1. Objection: [Exact wording a prospect uses]
     Response: [The reframe or proof point that resolves it]
  2. Objection:
     Response:
  3. Objection:
     Response:

Non-ideal fit:
  - [Profile of a customer who should not buy — be specific]
  - [Profile of a customer who will churn or be unsuccessful]

Disqualifiers: [Conditions that make this product the wrong choice]
```

### 8. Switching Dynamics (JTBD Four Forces)

The Four Forces framework captures why customers switch to a new product or stay with the old one.

```
Push forces (away from the old solution):
  - [What frustrations or failures make them leave the status quo?]

Pull forces (toward the new solution):
  - [What promises or outcomes draw them toward this product?]

Habit forces (resisting change):
  - [What behaviors, integrations, or switching costs keep them in place?]

Anxiety forces (resisting adoption):
  - [What fears about the new solution slow or block the decision?]
```

Use this to identify where the buying journey stalls and what messaging removes the blocker.

### 9. Customer Language

**This section is the most valuable and hardest to fill in. Prioritize verbatim customer phrases over polished marketing language.**

```
How customers describe the problem (verbatim):
  - "[Exact quote from interview, support ticket, or review]"
  - "[Exact quote]"

How customers describe the solution (verbatim):
  - "[Exact quote about what they value or how they explain it to others]"
  - "[Exact quote]"

Terminology they use:
  - Words they use for the problem: [e.g., "manual process", "flying blind", "patchwork"]
  - Words they use for the solution: [e.g., "single source of truth", "just works", "finally"]
  - Words they avoid or dislike: [jargon or framing that feels off]

Sources: [interviews, NPS comments, support tickets, G2 reviews, sales calls]
```

### 10. Brand Voice

```
Tone: [e.g., direct and confident / warm and approachable / technical and precise]
Communication style: [formal / conversational / technical / plain-language]
Personality traits: [3–5 adjectives that describe the brand personality]
What we sound like: [Reference brand or voice — "like Stripe, but warmer"]
What we don't sound like: [Contrast brand]
Copy conventions:
  - [e.g., use second person, avoid passive voice, Oxford comma, etc.]
```

### 11. Proof Points

```
Quantified outcomes:
  - [Metric]: [e.g., "Customers reduce onboarding time by 60%"]
  - [Metric]:

Notable customers or logos: [if reference-able]

Testimonials (verbatim or paraphrased):
  - "[Quote]" — [Name, Title, Company]

Common value themes: [The 2–3 outcomes that customers cite most often]

Awards or recognition: [press, analyst mentions, certifications if relevant]
```

### 12. Goals

```
Business objective: [What the company is trying to achieve this quarter/year]
Primary conversion action: [What counts as a conversion — demo booked, trial started, paid, etc.]
Current baseline metrics:
  - Traffic: [monthly visitors]
  - Conversion rate: [current rate at primary conversion point]
  - CAC: [customer acquisition cost]
  - Win rate: [if sales-led]
Target improvement: [What success looks like after the marketing initiative]
```

---

## Quality Checks

Before saving the document, confirm:

- [ ] One-liner is specific enough to be meaningful (not "we help teams work better")
- [ ] Customer language section contains at least two verbatim quotes from real customers
- [ ] Objections are written in prospect language, not internal language
- [ ] Switching dynamics call out at least one anxiety force (the most commonly missed)
- [ ] Differentiation describes mechanisms, not just outcomes ("because of X" not just "so you get Y")
- [ ] Anti-personas are specific enough to be useful for qualifying conversations

---

## Downstream Use

Once created, this document is referenced by:
- Landing page generation — copy, headline framing, proof section
- Content strategy — pillar development and buyer stage mapping
- Competitive brief — differentiation and response planning
- PRD context sections — user and problem framing
- Experiment hypotheses — behavioral mechanism identification
- Psychology brief — identifying which mental models apply to this specific buyer

Load it at the start of any marketing or positioning task so the agent has grounded context without re-gathering inputs.
