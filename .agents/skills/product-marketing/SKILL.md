---
name: product-marketing
description: >-
  Use for product marketing work: positioning, messaging, ICPs, product
  marketing context, landing pages, CRO, content strategy, buyer psychology,
  proof points, and brand voice. Choose this when the user needs market-facing
  narrative or conversion-focused assets before execution.
metadata:
  short-description: Shape positioning, messaging, and conversion assets
---

# Product Marketing

Use this skill to turn fuzzy positioning, weak messaging, or underperforming market-facing assets into a clear narrative, context, and conversion plan.

Treat this as the market-facing companion to `../product-development/SKILL.md`.

Keep `SKILL.md` focused on the operating model. Load only the reference file that matches the request:

- `references/product-marketing-context.md` for the 12-section product marketing context framework, the auto-draft workflow from existing materials, the conversational gathering path, and the downstream-use guide
- `references/content-strategy.md` for content pillar development, keyword and buyer-stage mapping, topic cluster planning, and content prioritization
- `references/content-led-marketing-plan.md` for content-first audience growth, platform and cadence selection, build-in-public planning, email-list strategy, and when to defer or layer in paid spend
- `references/lead-magnet-strategy.md` for general lead magnet planning: buyer-stage matching, format selection, gating, delivery, distribution, and measurement
- `references/survey-to-lead-magnet.md` for clustering survey pain points into ranked audience segments and generating lead magnet briefs with format, hook, outline, CTA, and channel recommendations
- `references/landing-page-generation.md` for the landing-page workflow, design style reference, section patterns, performance targets, and delivery rules
- `references/landing-page-copy-frameworks.md` for PAS, AIDA, BAB, and 4Ps copy frameworks with headline and CTA patterns
- `references/copy-editing.md` for structured editing of existing marketing copy through sequential clarity, voice, benefit, proof, specificity, emotion, and risk-reduction passes
- `references/landing-page-patterns.md` for page layouts, social proof placement, pricing presentation, form optimization, and testable conversion patterns
- `references/landing-page-seo-checklist.md` for final SEO, Core Web Vitals, metadata, and structured-data validation
- `references/page-cro.md` for diagnosing existing marketing pages and producing prioritized CRO recommendations
- `references/marketing-psychology.md` for persuasion, pricing psychology, buyer behavior, and activation/friction models
- `../product-development/references/competitive-strategy.md` when the marketing task requires competitive framing, category positioning, or differentiation grounded in strategy
- `../product-development/references/experiment-playbook.md` and `../product-development/references/statistics-reference.md` when CRO recommendations need test design, stopping rules, or sample sizing

## Tools

One executable script is available when the user wants a production-ready marketing asset:

- `scripts/landing_page_scaffolder.py` — generates a complete landing page as HTML or Next.js TSX from a JSON config. Supports four Tailwind design styles and all major section types (hero, features, pricing, testimonials, CTA, footer). Run with `python scripts/landing_page_scaffolder.py config.json --format tsx --output LandingPage.tsx`. See `references/landing-page-generation.md` for the JSON input format.

## Use this skill for

- positioning and messaging strategy
- ICP definition and persona documentation
- product marketing context creation and maintenance in `.agents/product-marketing-context.md`
- customer language capture from interviews, reviews, sales notes, support tickets, or docs
- differentiation, objection handling, and switching-dynamics analysis
- brand voice documentation and proof-point curation
- landing page creation and optimization
- CRO audits for homepage, landing page, pricing, feature, or campaign pages
- copy editing for existing market-facing assets without changing the core strategy
- landing page copy using PAS, AIDA, BAB, and 4Ps frameworks
- pricing page framing and persuasion strategy
- content strategy, topic clusters, and editorial prioritization
- content-led marketing plans and audience-building strategy
- general lead magnet strategy, gating, delivery, and distribution
- survey segmentation and lead magnet strategy from raw respondent language
- buyer psychology analysis for acquisition, activation, and conversion flows
- launch messaging and market-facing narrative development

## Skills chaining

If the request shifts from market-facing narrative into product definition or delivery planning, load `../product-development/SKILL.md`.

Use `product-development` for:

- PRDs, feature briefs, and roadmap tradeoffs
- prioritization, discovery, and experiment planning
- release scope, sprint planning, and story breakdown
- product org design, OKRs, and broader product strategy

## Boundary

This skill is for market-facing product narrative, acquisition, and conversion work.

- Focus on buyer understanding, messaging clarity, objections, proof, and conversion paths.
- Prefer customer language and proof over internal jargon.
- If the user later wants PRDs, sequencing, or delivery-ready scope, hand off to `product-development`.

## Default output modes

Choose the mode that best matches the request:

- **Positioning brief**: for category framing, narrative, and differentiation
- **Messaging brief**: for core messaging architecture, value props, and proof
- **ICP brief**: for target segments, buying roles, and qualification boundaries
- **Product marketing context**: for creating or updating `.agents/product-marketing-context.md`
- **Landing page**: for a complete conversion-optimised landing page as Next.js TSX or HTML
- **CRO audit**: for diagnosing an existing marketing page and prioritising fixes
- **Copy edit**: for tightening existing messaging while preserving strategy and voice
- **Content strategy**: for content pillars, topic clusters, and editorial prioritisation
- **Marketing plan**: for content-led audience growth, channel selection, cadence, and email-list strategy
- **Lead magnet brief**: for general lead magnet planning or converting survey data and audience pain clusters into acquisition offers
- **Psychology brief**: for applying buyer psychology or pricing psychology to a specific challenge
- **Voice guide**: for brand voice, tone, and copy conventions
- **Proof-point brief**: for outcomes, testimonials, and value-theme packaging

## Required thinking order

Work in this order unless the user explicitly overrides it:

1. Product and market context
2. Buyer or segment
3. Evidence and customer language
4. Desired action or conversion
5. Competitive frame
6. Options and tradeoffs
7. Recommended message, narrative, or asset direction
8. Success metrics
9. Risks and open questions

Do not jump straight to taglines or page sections.

## Product Marketing Context

When the user needs to establish foundational positioning, create or update a marketing context file, define an ICP, document customer language, or prepare shared context for downstream marketing work, load and follow `references/product-marketing-context.md`.

### Auto-Draft Workflow

When existing materials are available, analyze them to generate an initial draft before asking questions:

| Source | Signals to extract |
|---|---|
| `README.md` | Product description, key benefits, target audience |
| Landing page copy | Headline framing, feature positioning, social proof |
| `package.json` / `pyproject.toml` | Category signals from keywords and description |
| Blog posts / docs | Customer language, use cases, competitive framing |

Mark inferred sections with `[INFERRED — please validate]`. Present the draft and iterate from there.

### Conversational Path

When no materials are available, gather context section-by-section. Ask specific questions with examples rather than open-ended prompts. Validate each section before moving to the next.

### Output

Save the completed document to `.agents/product-marketing-context.md`. This file is automatically referenced by landing page generation, content strategy, CRO work, and psychology briefs.

### Product Marketing Context contract

When producing a product marketing context document, deliver all 12 sections:

1. Product Overview (one-liner, description, category, type, business model)
2. Target Audience (company type, size, geography, decision-makers, primary use case, JTBD statements)
3. Personas — User, Champion, Decision Maker, Financial Buyer, Technical Influencer (B2B); or single profile (B2C)
4. Problems and Pain Points (core challenge, solution gaps, cost, emotional tension, urgency drivers)
5. Competitive Landscape (direct, secondary, indirect competitors with shortcomings; category perception)
6. Differentiation (differentiators with mechanism explanation, benefits, selection reasons, category frame)
7. Objections and Anti-Personas (top 3 objections with responses; non-ideal fit profiles; disqualifiers)
8. Switching Dynamics — JTBD Four Forces (Push, Pull, Habit, Anxiety)
9. Customer Language (verbatim problem and solution descriptions; terminology; sources)
10. Brand Voice (tone, communication style, personality traits, copy conventions)
11. Proof Points (quantified outcomes, notable customers, testimonials, value themes)
12. Goals (business objective, primary conversion action, baseline metrics, target improvement)

Quality bar: the Customer Language section must contain verbatim quotes. Objections must be written in prospect language. Switching Dynamics must include at least one anxiety force.

## Landing Page Generation

When the user asks to create, improve, or A/B test a landing page, marketing page, homepage, or conversion-optimised web page, load and follow `references/landing-page-generation.md`.

### Inputs to collect before generating

```text
Product: [name]
Tagline: [one sentence value prop]
Target audience: [who they are]
Key pain point: [what problem you solve]
Key benefit: [primary outcome]
Pricing tiers: [free/pro/enterprise or describe]
Design style: dark-saas | clean-minimal | bold-startup | enterprise
Copy framework: PAS | AIDA | BAB
```

Ask only for missing fields. Infer design style and copy framework from brand voice when existing content is provided.

### Reference loading guide

| Task | Load |
|---|---|
| Building a content-first marketing plan or audience-growth plan | `content-led-marketing-plan.md` |
| Planning or improving a lead magnet from scratch | `lead-magnet-strategy.md` |
| Auditing an existing marketing page for conversion problems | `page-cro.md` |
| Turning survey responses into segmented lead magnets | `survey-to-lead-magnet.md` |
| Generating or scaffolding a landing page | `landing-page-generation.md` |
| Writing or reviewing headlines, CTAs, body copy | `landing-page-copy-frameworks.md` |
| Editing existing market-facing copy without rewriting strategy | `copy-editing.md` |
| Selecting layouts, social proof, pricing presentation | `landing-page-patterns.md` |
| Pre-launch SEO validation | `landing-page-seo-checklist.md` |
| Applying buyer psychology to copy, pricing, or UX flows | `marketing-psychology.md` |
| Turning CRO recommendations into real experiments | `../product-development/references/experiment-playbook.md` + `../product-development/references/statistics-reference.md` |

### CRO audit contract

When producing a CRO audit, do this before making recommendations:

1. Read `.agents/product-marketing-context.md` if it exists
2. Identify page type, primary conversion goal, and traffic source
3. Capture current conversion baseline, target, and downstream flow if available
4. Check whether user research, heatmaps, session recordings, or prior tests exist

Deliver the audit in four buckets:

- `Quick Wins`
- `High-Impact Changes`
- `Test Ideas`
- `Copy Alternatives`

Prioritize by leverage, not by the number of issues found. If experiment design becomes the main job, chain to `../product-development/SKILL.md`.

For recurring or portfolio audits, also include:

- an operational 8-dimension CRO scorecard
- a total score and letter grade
- benchmark context or baseline comparison when available
- a recommended audit cadence: pre-launch, weekly for priority pages, monthly for the broader set

### Landing page contract

When producing a landing page, deliver:

- Complete TSX components (or HTML if specified) — not wireframes or descriptions
- All Tailwind classes matching the chosen design style
- Actual product copy using the chosen framework — not placeholder text
- SEO meta tags and Open Graph tags
- Structured data where applicable (FAQPage, Product)
- Explicit Core Web Vitals notes (preload hero image, lazy-load below fold, explicit image dimensions)

Validate against `references/landing-page-seo-checklist.md` before final output. Fix every gap inline.

## Content-led marketing-plan contract

When the user asks for a marketing plan centered on content, audience growth, or email capture before paid ads:

1. assess whether the product, audience, and proof are mature enough for content scaling
2. define the funnel stages the content should move people through
3. choose one primary channel before recommending a broader channel mix
4. define the email capture layer and the lead offer or newsletter promise
5. recommend a sustainable cadence the team can actually maintain

Return:

- a channel and cadence plan
- content ideas across educate, inspire, and entertain modes
- an email-list strategy
- a build-in-public plan where appropriate
- explicit guidance on whether paid should be deferred, tested, or layered in later

## Lead magnet strategy contract

When the user wants a lead magnet but does not start with survey data:

1. identify the target buyer stage and the specific pain or decision to solve
2. pick the lowest-effort format that still creates a strong value exchange
3. define the gating, form fields, landing-page structure, and delivery method
4. specify the next step after conversion so the asset leads naturally into product adoption
5. define the distribution and measurement plan before recommending creative variations

Return:

- a lead magnet recommendation with format, topic, and audience
- a content brief or outline
- the capture and delivery plan
- the distribution plan
- KPIs plus the first A/B test worth running

## Survey-to-lead-magnet contract

When the user provides survey data or pain-point responses:

1. identify the columns or answers that contain pain, goals, blockers, or JTBD signals
2. cluster respondents into meaningful pain-point segments
3. rank segments by size, commercial potential, and clarity of message
4. generate a lead magnet brief for the strongest segment first

Return:

- a segment table with representative quotes
- ranked lead magnet opportunities
- a full brief for the highest-priority concept
- the recommended CTA and distribution channel

## Copy editing contract

When the user provides existing copy to improve:

1. Read `.agents/product-marketing-context.md` if it exists
2. Identify the asset type, buyer, and primary conversion action
3. Run the edit in ordered passes using `references/copy-editing.md`
4. Preserve the strategy unless the strategy itself is the diagnosed issue

Return:

- what is already working
- prioritized edits with rationale
- revised copy in replaceable form
- evidence gaps that still need proof or validation

## Product rules

- Every recommendation needs a clear buyer, a clear action, and a clear proof path.
- Prefer evidence and verbatim customer language over internal abstractions.
- Distinguish assumptions from evidence.
- Name the tradeoff. If a message gains focus, say what audience or narrative is being deprioritized.
- Tie landing-page or CRO advice to the likely traffic source and buyer intent.
- If a request mixes positioning with product scope, separate the market-facing recommendation from the product decision.
- For CRO work, fix message clarity, proof, and objection handling before suggesting cosmetic UI tweaks.

## Failure modes to avoid

- positioning written in internal product language rather than customer language
- differentiation described as outcomes only ("faster") without the mechanism that makes it true
- customer language sections filled with polished summaries instead of verbatim quotes
- personas that collapse different buying roles into one blended profile
- anti-personas left vague ("not for enterprise") rather than specific enough to qualify or disqualify
- switching dynamics missing the anxiety forces — often the actual blocker
- landing pages that lead with features before the problem, buyer, or proof
- CRO audits that list dozens of issues with no leverage-based prioritization
- recommending CTA color changes before fixing message clarity and CTA language
- writing A/B test ideas without checking whether traffic is sufficient to learn anything
- ignoring traffic-source context in a CRO audit
- content plans not mapped to buyer stage or search/shareability dynamics
- case studies without quantified outcomes
- persuasion tactics that rely on fake urgency or other trust-eroding shortcuts

## Quality bar

- The reader can explain who the message is for, what action it is trying to drive, and why the narrative should work.
- Differentiation is specific and defensible.
- Proof and objections are concrete enough to use in copy or sales conversations.
- The recommended asset direction is narrow enough to execute, not just discuss.
