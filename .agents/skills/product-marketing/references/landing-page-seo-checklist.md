# Landing Page SEO Checklist

Apply these checks before launching any landing page. Run through every item and fix gaps inline — do not skip items.

---

## Meta Tags

- [ ] **Title tag**: under 60 characters, includes primary keyword, ends with brand name
- [ ] **Meta description**: 150-160 characters, includes CTA language, unique per page
- [ ] **Canonical URL**: set to prevent duplicate content issues
- [ ] **Robots meta**: ensure page is indexable (`index, follow`) unless intentionally noindex
- [ ] **Open Graph tags**: og:title, og:description, og:image (1200×630px), og:url
- [ ] **Twitter Card tags**: twitter:card, twitter:title, twitter:description, twitter:image
- [ ] **Viewport meta**: `<meta name="viewport" content="width=device-width, initial-scale=1">`

---

## Structured Data

- [ ] **Organization schema**: company name, logo, social profiles
- [ ] **Product schema**: name, description, price, availability (for product pages)
- [ ] **FAQ schema**: for pages with FAQ sections (rich snippet opportunity)
- [ ] **Breadcrumb schema**: navigation path for deep pages
- [ ] **Review schema**: aggregate rating if testimonials present (use carefully per guidelines)
- [ ] **Validate**: test all structured data with Google Rich Results Test

---

## Core Web Vitals

### Largest Contentful Paint (LCP) — Target: < 2.5s
- [ ] Optimize hero image (WebP format, proper dimensions)
- [ ] Preload critical resources (`<link rel="preload">` and `priority` prop on Next/Image)
- [ ] Use CDN for static assets
- [ ] Minimize render-blocking CSS and JavaScript

### First Input Delay / Interaction to Next Paint (INP) — Target: < 200ms
- [ ] Defer non-critical JavaScript
- [ ] Break up long tasks (>50ms)
- [ ] Minimize third-party script impact

### Cumulative Layout Shift (CLS) — Target: < 0.1
- [ ] Set explicit width/height on all images and videos
- [ ] Reserve space for dynamic content (ads, embeds)
- [ ] Use `font-display: swap` for web fonts
- [ ] Avoid inserting content above existing content

---

## Keyword Placement

- [ ] **H1 tag**: contains primary keyword, one per page only
- [ ] **H2 tags**: include secondary keywords naturally
- [ ] **First paragraph**: primary keyword appears in first 100 words
- [ ] **Body copy**: natural keyword density (1-2%), no stuffing
- [ ] **Image alt text**: descriptive, includes keyword where relevant
- [ ] **URL slug**: short, keyword-rich, hyphen-separated
- [ ] **CTA text**: consider keyword inclusion where natural

---

## Internal Linking

- [ ] Link to relevant product/feature pages
- [ ] Link to blog content that supports the page topic
- [ ] Use descriptive anchor text (not "click here")
- [ ] Ensure landing page is linked from main navigation or sitemap
- [ ] Link to pricing page if applicable
- [ ] Limit links to avoid diluting page authority (15-20 max)

---

## Image Optimization

- [ ] **Format**: use WebP with JPEG/PNG fallback
- [ ] **Compression**: lossy for photos, lossless for graphics
- [ ] **Dimensions**: serve at exact display size (no CSS resizing)
- [ ] **Alt text**: descriptive, 125 characters max, natural keyword inclusion
- [ ] **File names**: descriptive, hyphenated (e.g., `product-dashboard-screenshot.webp`)
- [ ] **Lazy loading**: apply to images below the fold (`loading="lazy"`)
- [ ] **Responsive images**: use `srcset` for different viewport sizes

---

## Mobile Responsiveness

- [ ] **Mobile-friendly test**: pass Google Mobile-Friendly Test
- [ ] **Touch targets**: minimum 44x44px, 8px spacing between targets
- [ ] **Font size**: minimum 16px base font, no pinch-to-zoom needed
- [ ] **Content parity**: all critical content accessible on mobile
- [ ] **Horizontal scroll**: none present at any viewport width
- [ ] **Form usability**: appropriate input types (email, tel), autocomplete attributes
- [ ] **Media queries**: breakpoints at 480px, 768px, 1024px, 1200px minimum

---

## Technical SEO

- [ ] **HTTPS**: SSL certificate valid and active
- [ ] **Page speed**: < 3s load time on mobile (test with PageSpeed Insights)
- [ ] **XML sitemap**: page included in sitemap.xml
- [ ] **Robots.txt**: page not blocked by robots.txt
- [ ] **404 handling**: custom 404 page with navigation
- [ ] **Redirect chains**: no more than 1 redirect hop
- [ ] **Hreflang**: set for multi-language landing pages

---

## Content Quality Signals

- [ ] **Unique content**: no duplicate content from other pages
- [ ] **Content depth**: sufficient content for topic coverage (500+ words for SEO pages)
- [ ] **Readability**: grade level 6-8 for broad audiences
- [ ] **E-E-A-T signals**: author expertise, company authority, trust indicators
