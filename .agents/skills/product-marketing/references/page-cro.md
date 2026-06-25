# Page CRO — Conversion Rate Optimization Audit

Use this reference when auditing an existing marketing page (homepage, landing page, pricing page, feature page, blog post, etc.) to diagnose conversion problems and produce prioritized recommendations.

---

## Initial Assessment

Check for product marketing context first. If `.agents/product-marketing-context.md` exists (or `.claude/product-marketing-context.md` in older setups), read it before asking questions. Use that context to avoid repeating discovery work and to keep the audit aligned with the established buyer, proof, and conversion goal.

Before running the analysis, establish three things:

**1. Page type**
- Homepage
- Campaign landing page (paid, email, outbound)
- Pricing page
- Feature / product page
- Blog or content page
- Free trial / signup page
- Demo request page

**2. Primary conversion goal**
One goal only. If the page serves multiple goals, identify the primary one:
- Signup (free trial, freemium)
- Demo / sales request
- Purchase / checkout
- Email capture
- Content download (lead magnet)
- Upgrade / expansion

**3. Traffic source context**
Source shapes intent and therefore what the page must do:
- Paid search (high intent, comparison mode — lead with the outcome, not the story)
- Paid social (low intent, interruption context — hook fast, earn attention)
- Organic search (mixed intent — match the query, deliver the answer immediately)
- Direct / branded (high familiarity — social proof and next step matter most)
- Email / outbound (warm context — specific follow-through from the message)
- Referral / product (already converted once — friction reduction and upgrade logic)

Capture these five supporting inputs if they are available:
- Current conversion rate and target conversion rate
- What happens immediately after the click or form submit
- Existing user research, heatmaps, or session recordings
- Traffic volume by source, especially for test feasibility
- What has already been tried so the audit does not recycle failed ideas

---

## Operational Scorecard

Use this scorecard when the user wants a recurring audit, portfolio comparison, or a simple benchmarkable CRO health score across multiple pages.

This scorecard does not replace the deeper analysis below. It compresses the audit into a trackable operating view.

### Eight scored dimensions

| Dimension | What it measures | Weight |
|---|---|---|
| Headline Clarity | Value proposition and audience clarity in under 5 seconds | 15% |
| CTA Visibility | Primary CTA prominence, contrast, and above-the-fold presence | 20% |
| Social Proof | Testimonials, logos, case studies, review signals, usage numbers | 15% |
| Urgency | Genuine scarcity, timing pressure, or action-forcing incentive | 5% |
| Trust Signals | Security, guarantees, privacy reassurance, certifications, credibility | 10% |
| Form Friction | Field count, complexity, intimidation, recovery from errors | 15% |
| Mobile Responsiveness | Touch targets, layout, scanning, and mobile usability | 10% |
| Page Speed Indicators | Weight, script load, image handling, obvious performance risks | 10% |

Total CRO score = weighted average across all eight dimensions.

### How to use it

- use for weekly tracking on top landing pages
- use pre-launch before driving paid traffic
- use monthly for competitor or portfolio comparisons
- use alongside, not instead of, the deeper diagnosis and recommendations

### Score interpretation

- **A / A+**: strong page, optimization is mostly in testing and proof density
- **B**: good base, several meaningful conversion gaps remain
- **C**: mixed signal, message and flow likely underperforming
- **D / F**: page is leaking attention or trust in obvious places

If exact benchmarks are unavailable, compare:
- against the page's own previous score
- against sister pages in the same funnel
- against pages of the same type and traffic intent

---

## Seven Analysis Dimensions (priority order)

Work through these in order. Issues higher in the list have more leverage over conversion.

### 1. Value Proposition Clarity

**What to check:**
- Can a visitor who has never heard of this product describe what it does, who it's for, and why it's different — within 5 seconds of landing on the page?
- Is the hero section leading with outcomes or features?
- Is the language the customer's own language, or internal/technical jargon?
- Is there a clear "for whom" signal in the first viewport?

**Common failures:**
- "Platform for modern teams" — describes the category, not the outcome
- Verb-heavy headlines about product actions ("Build, collaborate, ship") without naming the benefit
- Targeting everyone by omitting the "for whom" → targeting no one

**Fix pattern:**
`[Outcome] for [persona] who [context or trigger]`
Example: "Close 40% more deals without adding headcount — for B2B sales teams running outbound."

---

### 2. Headline Effectiveness

**What to check:**
- Does the headline name a specific, desirable outcome?
- Does it address the primary pain point or job-to-be-done of the target persona?
- Is it scannable at a glance (≤12 words ideal, ≤18 words acceptable)?
- Does the subheadline complement rather than repeat the headline?

**Tested headline patterns:**
- `Get [benefit] without [pain point]`
- `The [fastest/easiest/only] way to [achieve outcome]`
- `[Persona]: [outcome statement]` — e.g., "Engineering managers: ship faster without burning your team."
- `Stop [pain point]. Start [benefit].`
- Question form: `What if [pain point] was no longer a problem?`

**What to flag:**
- Clever over clear — wit that requires a second read loses visitors
- Feature-first headlines: "The all-in-one project management suite" (feature) vs. "Ship projects on time, every time" (outcome)
- Mismatched message between the ad/email and the landing page (scent break)

---

### 3. CTA Placement and Copy

**What to check:**
- Is the primary CTA visible above the fold without scrolling on both desktop and mobile?
- Is there exactly one primary CTA per viewport? (Multiple competing CTAs split attention and reduce clicks on all of them.)
- Does the CTA copy name the value, not the action?
- Is the CTA repeated at the end of the page and after each major section for long pages?

**CTA copy patterns (value-driven vs. action-driven):**

| Action-driven (weak) | Value-driven (stronger) |
|---|---|
| Submit | Get my free audit |
| Sign up | Start my free trial |
| Learn more | See how it works |
| Download | Get the playbook |
| Request a demo | Talk to sales |
| Buy now | Start saving today |

**Placement rules:**
- Hero: primary CTA + low-commitment secondary (e.g., "See a demo" + "Read case study")
- After feature section: reinforce with a specific outcome CTA ("Start shipping faster")
- After social proof section: capitalize on trust momentum
- Footer / bottom of page: capture intent from readers who scrolled all the way down

---

### 4. Visual Hierarchy

**What to check:**
- Does the eye naturally flow from headline → subheadline → CTA → supporting content?
- Is the most important element on the page the visually dominant element?
- Is there adequate white space to prevent cognitive overload?
- Is the CTA button visually distinct from background and other elements (contrast ratio)?

**Common hierarchy failures:**
- Hero image more visually dominant than the headline
- CTA button color blends with the page palette (low contrast = low click rate)
- Too many competing elements at the same visual weight
- Dense text blocks in the hero that delay the 5-second value scan

**Mobile-specific checks:**
- Headline legible without zooming (minimum 20px)
- CTA button tappable (minimum 44×44px tap target)
- Navigation doesn't push the hero out of the first viewport
- Images don't break the text flow on small screens

---

### 5. Trust Signals

**What to check:**
- Are customer logos, testimonials, or case studies present — and are they specific?
- Are trust signals placed at the right moments (near CTAs, after pricing, after the value prop)?
- Are they authentic and specific, or generic filler?

**Trust signal types by effectiveness (highest to lowest for most B2B pages):**

1. **Quantified case studies** — "Acme Corp reduced churn by 34% in 90 days"
2. **Named testimonials with title and company** — not anonymous quotes
3. **Recognizable customer logos** — with optional "Trusted by 10,000+ teams" claim
4. **G2 / Capterra / review platform badges** — with star rating and review count
5. **Press mentions** — "As seen in" with logos
6. **Security / compliance badges** — SOC 2, GDPR, ISO — especially near pricing
7. **Usage numbers** — "1.2M data points processed daily" — concrete beats vague

**What to flag:**
- Testimonials without attribution: "This product changed my life" — anonymous = ignored
- Logos that visitors won't recognize — name recognition is the entire point
- Social proof placed only at the bottom — put it where doubt arises (near the CTA, below pricing)
- Review badge with no star count or review count visible

---

### 6. Objection Handling

**What to check:**
- Does the page address the three universal B2B objections: cost/ROI, implementation complexity, and risk of switching?
- Are objections handled at the point in the flow where they naturally arise — not bundled into an FAQ at the bottom?
- Is there a risk reversal (money-back guarantee, free trial, no credit card required)?

**Objection trigger points and handling patterns:**

| Objection | Where it arises | Handling pattern |
|---|---|---|
| "Is it worth the price?" | Pricing section | ROI framing — "Pays for itself after [N] use case" |
| "How hard is setup?" | Feature section | "Live in [X hours/minutes]" + setup screenshot |
| "Will it integrate with our stack?" | Feature / FAQ | Integration logos or compatibility list |
| "What if it doesn't work?" | Near CTA | Money-back guarantee / free trial / no-CC-required badge |
| "Are we too small/big for this?" | Hero or pricing | Pricing tier names that signal scale fit |
| "Can I trust this company?" | Near social proof | Team size, founded year, customer count, press |

---

### 7. Friction Points

**What to check:**
- Form fields: every additional field above the minimum required reduces conversion. For top-of-funnel, ask for email only.
- Navigation: does the nav offer too many escape routes on a campaign landing page? (Best practice: remove or simplify nav on dedicated landing pages.)
- Load time: a page load above 3s on mobile can cut conversion in half. Check Largest Contentful Paint (LCP).
- Mobile experience: is the page designed mobile-first or desktop-first with a mobile adaptation?
- Pop-ups / interstitials: any element that appears before the user has engaged destroys trust and increases bounce.

**Form field audit:**
- Remove: job title, phone number, company size (unless required for routing)
- Keep: email (required), first name (personalization), company (B2B qualification only if necessary)
- Consider progressive profiling: ask for extra data on the thank-you page or in onboarding, not the signup form

---

## Deliverable Structure

Organize every CRO audit output into four buckets:

### 1. Quick Wins
Changes that can be shipped in under a day with no design or engineering work. Usually copy, button labels, or content reordering.

Format:
```
[Dimension] — [Current state] → [Recommended change]
Rationale: [1 sentence]
```

### 2. High-Impact Changes
Substantive modifications that require design and/or engineering. Prioritize by estimated conversion lift × implementation cost.

Format:
```
[Change name]
Current: [describe the problem]
Recommendation: [describe the solution]
Expected impact: [conversion lever — which dimension and why]
Effort: S / M / L
```

### 3. Test Ideas
Hypotheses for A/B or multivariate experiments. Format as If/Then/Because.

```
If we change [X],
Then [metric] will change by [direction/magnitude],
Because [behavioral mechanism].

Traffic required: [use sample_size_calculator.py]
Primary metric: [one metric]
Guardrail: [one metric]
```

### 4. Copy Alternatives
Multiple variants for high-leverage copy elements (headline, subheadline, CTA). Minimum 3 variants per element with rationale.

Format:
```
Element: [Headline / CTA / Subheadline]
Current: "[existing copy]"

Variant A: "[copy]" — [rationale: framework used, e.g., outcome-focused, pain-first]
Variant B: "[copy]" — [rationale: persona-specific, question format, etc.]
Variant C: "[copy]" — [rationale: numbers/specificity, social proof hook, etc.]
```

### 5. Scorecard Summary

When the user asks for a benchmarkable or recurring audit, append:

```markdown
Overall CRO Score: [0-100]
Letter Grade: [A+ to F]

Dimension Scores
- Headline Clarity: [score]
- CTA Visibility: [score]
- Social Proof: [score]
- Urgency: [score]
- Trust Signals: [score]
- Form Friction: [score]
- Mobile Responsiveness: [score]
- Page Speed Indicators: [score]

Tracking Note: [what to monitor next week / next launch / next test cycle]
```

---

## Page-Specific Frameworks

Apply the base seven-dimension audit differently depending on the page type:

### Homepage
- Optimize for cold traffic first: visitors should understand product, buyer, and outcome within one screen
- Create a fast path for high-intent visitors and a second path for researchers who still need proof
- Make the primary navigation support discovery rather than distract from the main conversion path

### Campaign Landing Page
- Match the promise and language from the ad, email, or outbound message exactly enough to preserve message scent
- Remove or simplify navigation so the page can complete one argument
- Keep one dominant CTA and repeat it at key decision points

### Pricing Page
- Make plan differences obvious without forcing line-by-line comparison work
- Signal the recommended plan clearly
- Reduce "which plan is right for me?" anxiety with use-case cues, FAQs, and an escalation path

### Feature / Product Page
- Translate features into user outcomes before showing product detail
- Use examples, screenshots, and use cases to prove the mechanism
- End with a clear next step to try, buy, or speak with sales

### Blog / Content Page
- Match the CTA to the article intent instead of dropping in a generic signup prompt
- Place inline CTAs at natural stopping points
- Use lead capture only when it feels like a continuation of the content promise

### Signup / Demo Request Page
- Strip fields to the minimum needed for routing or follow-up
- Clarify exactly what happens next and how long it will take
- Use reassurance near the form: privacy, no credit card, response time, or qualification expectations

---

## Experiment Ideas

When recommending experiments, bias toward the parts of the page with the highest leverage:

- Hero section: headline, subheadline, hero proof, CTA copy, CTA count
- Trust signals: logo bar placement, testimonial specificity, quantified outcomes, review badges
- Pricing presentation: plan order, recommendation label, annual/monthly framing, FAQ placement
- Forms: field count, required fields, reassurance copy, inline validation
- Navigation and UX: reduced nav, sticky CTA, mobile-first hierarchy, scroll depth pacing

Write tests in If / Then / Because format and estimate feasibility before recommending them as a real next step.

For execution planning, sample sizing, and stopping rules, pair this reference with:
- `../product-development/references/experiment-playbook.md`
- `../product-development/references/statistics-reference.md`
- `../product-development/scripts/sample_size_calculator.py`

---

## Task-Specific Questions

Ask only for information missing from the page, available context files, or supplied materials:

1. What is the current conversion rate and the target improvement?
2. Where is traffic coming from, and which source matters most?
3. What does the signup, demo, or purchase flow look like after this page?
4. Do you have user research, heatmaps, or session recordings?
5. What have you already tested or changed?

---

## Integration with Other References

| Need | Load |
|---|---|
| Writing or rewriting the copy alternatives | `landing-page-copy-frameworks.md` |
| Selecting a new layout or section pattern | `landing-page-patterns.md` |
| Applying psychology models to objection handling or trust | `marketing-psychology.md` |
| Designing A/B tests from the Test Ideas bucket | `experiment-playbook.md` + `statistics-reference.md` |
| Running a pre-launch SEO check after copy changes | `landing-page-seo-checklist.md` |
| Rebuilding the page from scratch | `landing-page-generation.md` |

---

## Failure modes to avoid

- Auditing visual design before message clarity — hierarchy problems are almost always downstream of a weak value proposition
- Recommending CTA color changes before fixing the CTA copy — color is noise; language is leverage
- Flagging every issue instead of prioritizing by leverage — a CRO audit that lists 30 items of equal weight gets nothing done
- Suggesting complex personalization before the default experience is strong
- Writing test ideas without estimating the traffic required — an underpowered test is worse than no test
- Treating mobile as an afterthought — mobile traffic commonly exceeds 60% on paid campaigns
- Adding trust signals without making them specific — vague social proof erodes trust instead of building it
- Recommending experiments without checking whether the post-click flow can actually absorb more conversions
