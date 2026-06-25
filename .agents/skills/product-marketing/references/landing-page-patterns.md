# Landing Page Patterns

Proven design and layout patterns that drive higher conversion rates, with placement guidance, implementation notes, and page-level templates.

---

## Hero Section Layouts

### Pattern 1: Left Copy + Right Product Screenshot
- **Best for:** SaaS products with a strong visual UI
- **Structure:** Headline, subheadline, CTA on left (60%); product screenshot on right (40%)
- **Why it works:** F-pattern reading leads with copy, product image provides proof

### Pattern 2: Centered Copy + Full-Width Background
- **Best for:** Brand-driven products, consumer apps
- **Structure:** Centered headline, subheadline, CTA over background image/gradient
- **Why it works:** Focuses attention on single message, high visual impact
- **Note:** Ensure text contrast against background for readability

### Pattern 3: Video Hero
- **Best for:** Complex products requiring demonstration
- **Structure:** Short headline + embedded video (60-90 seconds) + CTA below
- **Why it works:** Video explains what text cannot, increases time on page
- **Note:** Always include thumbnail; autoplay is often counterproductive

### Pattern 4: Interactive Demo
- **Best for:** Developer tools, data products, design tools
- **Structure:** Minimal copy + embedded interactive product experience
- **Why it works:** Hands-on experience converts better than description
- **Note:** Keep demo focused on one "aha moment" workflow

### Pattern 5: Problem-Solution Hero
- Headline names the painful problem
- Subheadline states the clear outcome
- Primary CTA starts immediately
- Optional supporting visual demonstrates product in context

### Pattern 6: Outcome-First Hero
- Headline leads with measurable value
- Subheadline clarifies who the page is for
- CTA is action-oriented and specific

### Pattern 7: Authority Hero
- Headline + trust indicator (logos, testimonial snippet, proof metric)
- Useful when category skepticism is high

---

## Social Proof Placement

### Logo Bar
- **Position:** Immediately below hero section
- **Count:** 5-7 logos for credibility without clutter
- **Label:** "Trusted by" or "Used by teams at"
- **Selection:** Mix recognizable brands with relevant industry logos

### Testimonial Cards
- **Position:** After feature explanation sections
- **Format:** Photo + name + title + company + specific quote
- **Best quotes:** Include measurable outcomes ("Saved 10 hours/week")
- **Layout:** 2-3 testimonials in a row, carousel for more

### Case Study Callouts
- **Position:** Mid-page, before pricing
- **Format:** Company logo + headline metric + "Read the story" link
- **Example:** "Acme Corp reduced onboarding time by 60%"

### Social Proof Numbers
- **Position:** Near CTA or in dedicated trust section
- **Format:** Large number + descriptor (e.g., "50,000+ teams", "4.8/5 rating")
- **Selection:** Choose 3-4 most impressive metrics

---

## Pricing Table Designs

### Good/Better/Best (3-Tier)
- Most effective for SaaS with clear feature tiers
- Highlight recommended plan with visual emphasis
- Show annual discount prominently
- Include feature comparison matrix below

### Simple Two-Tier
- Free/Pro or Starter/Professional
- Best for PLG products with clear upgrade trigger
- Minimize decision fatigue

### Enterprise Custom
- Replace price with "Contact Sales" for high-ACV products
- List enterprise-specific features (SSO, SLA, dedicated support)
- Include a "Talk to Sales" CTA, not just a form

### Pricing Psychology
- Anchor with highest-priced plan first (or in the middle with visual highlight)
- Use monthly price with annual billing toggle
- Show savings percentage for annual plans
- Round prices ending in 9 (e.g., $49/mo, $99/mo)

---

## Trust Signals

### Security Badges
- SOC 2, ISO 27001, GDPR compliance badges
- SSL certificate indicator
- Place near forms and payment sections

### Guarantees
- Money-back guarantee with specific timeframe
- Free trial with no credit card requirement
- SLA uptime commitments

### Awards & Recognition
- Industry awards (best of, top rated)
- Analyst recognition (Gartner, Forrester, G2 Leader)
- Media mentions (as seen in logos)

---

## Form Optimization

### Field Reduction
- Every additional field reduces conversion ~10%
- Start with email only, progressive profiling later
- Use single-column layouts for forms

### Smart Defaults
- Pre-fill country based on IP
- Auto-detect company from email domain
- Default to most popular plan

### Inline Validation
- Validate fields on blur, not on submit
- Show success states (green checkmark)
- Provide helpful error messages

### Multi-Step Forms
- Break long forms into 2-3 steps with progress indicator
- Put easiest questions first to build commitment

---

## Mobile-First Patterns

### Thumb-Friendly Design
- CTAs in thumb zone (bottom 40% of screen)
- Minimum tap target: 44x44px
- Adequate spacing between interactive elements

### Content Priority
- Lead with most compelling content (no scrolling to find CTA)
- Collapse secondary information into accordions
- Use sticky CTA bar on scroll

### Performance
- Target <3s load time on 3G
- Lazy-load images below fold
- Minimize JavaScript execution

---

## Page-Level Templates

### SaaS Demo Page
1. Hero with problem-solution framing
2. Product walkthrough section
3. Social proof strip
4. Benefits by persona
5. Objection handling FAQ
6. Final CTA

### Lead Magnet Page
1. Promise + asset preview
2. Bullet outcomes
3. Short form
4. Trust/privacy note

### Product Launch Page
1. Outcome-first hero
2. Why now / differentiation
3. Feature blocks
4. Testimonials / beta feedback
5. Pricing or waitlist CTA

---

## A/B Testing Priority Matrix

Test these elements in order of expected impact:

| Priority | Element | Expected Impact | Effort |
|----------|---------|----------------|--------|
| 1 | Headline | High | Low |
| 2 | CTA text and color | High | Low |
| 3 | Hero image/video | High | Medium |
| 4 | Social proof placement | Medium | Low |
| 5 | Form fields (fewer) | Medium | Low |
| 6 | Pricing presentation | Medium | Medium |
| 7 | Page length | Medium | High |
| 8 | Testimonial selection | Low | Low |
| 9 | Color scheme | Low | Medium |
| 10 | Font choices | Low | Low |

### Testing Best Practices
- Test one variable at a time for clear attribution
- Run tests for minimum 2 weeks or 1,000 visitors per variant
- Use 95% statistical significance threshold
- Document all test results for institutional knowledge
- Winner becomes new control for next test iteration
