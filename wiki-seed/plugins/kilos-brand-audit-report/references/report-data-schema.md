---
type: concept
name: Brand Audit Report Data Schema
description: JSON schema for report-data.json, the presentation-layer contract used by the KILOS brand audit HTML report.
tags: [reporting, schema, json, employer-brand]
---

# Report Data Schema — `report-data.json`

This is the complete schema for the data file that drives the HTML report. Every field is described with its type, purpose, and an example value.

The report renders correctly for any number of competitors (minimum 1) and any client or industry.

---

## Top-Level Structure

```json
{
  "reportMeta": { ... },
  "introContent": { ... },
  "client": { ... },
  "competitors": [ ... ],
  "comparison": { ... }
}
```

---

## `reportMeta`

Report-level metadata and asset references.

```json
{
  "reportMeta": {
    "reportId": "acme-corp-audit-2026-03",
    "reportTitle": "Employer Brand Competitive Audit",
    "reportSubtitle": "An Employer Brand Competitive Audit for the Engineering Talent Landscape.",
    "client": "Acme Corp",
    "auditDate": "2026-03-19",
    "footerText": "© 2026 Symphony Talent, LLC. All Rights Reserved.",
    "imageBase": "",
    "symphonyTalentLogo": "assets/images/_system/st-logo.png",
    "backgroundHero": "assets/images/_system/hero-bg.jpg",
    "backgroundContent": "assets/images/_system/content-bg.jpg",
    "kilosWatermark": "assets/images/_system/kilos-watermark.png"
  }
}
```

### Field reference

| Field | Type | Description |
|-------|------|-------------|
| `reportId` | string | Unique identifier for this report (used in filenames) |
| `reportTitle` | string | Main title shown in the browser tab and Overview hero |
| `reportSubtitle` | string | Subtitle shown beneath the main title in the hero |
| `client` | string | Client company name (for display; company data is in `client` object) |
| `auditDate` | string (YYYY-MM-DD) | Date of the audit |
| `footerText` | string | Footer copyright line |
| `imageBase` | string | Base URL prefix for images. Empty string `""` = use relative paths (local). Set to CDN URL for online deployment. |
| `symphonyTalentLogo` | string (localPath) | Path to the Symphony Talent logo |
| `backgroundHero` | string (localPath) | Path to the hero/overview section background image |
| `backgroundContent` | string (localPath) | Path to the content section background (summary, deep dives) |
| `kilosWatermark` | string (localPath) | Optional decorative KILOS watermark image used in hero |

---

## `introContent`

Text content for the Overview section.

```json
{
  "introContent": {
    "title": "Acme Corp: Competitor Employer Brand Review",
    "introduction": "The following audit presents an in-depth analysis of how key competitors position their employer brands to attract engineering talent. Focusing on messaging and engagement aimed at experienced software engineers and technical leaders, this review provides a comprehensive look at the competitive landscape.",
    "methodologyTitle": "Methodology",
    "methodology": "To complete this analysis, we examined publicly available content across each competitor's owned and earned channels, with particular focus on:",
    "methodologyFocusAreas": [
      "Careers website messaging and calls to action",
      "Engineering talent propositions and technical culture narratives",
      "Social media and digital campaign content targeting tech professionals",
      "Employee advocacy and senior leader presence on LinkedIn",
      "External recognition such as awards and rankings relevant to engineering careers"
    ],
    "closing": "This foundational work supports Acme Corp's ambition to position itself as a leading employer for top engineering talent, helping shape future campaigns, messaging strategies, and content development."
  }
}
```

---

## Company Object (used for both `client` and each entry in `competitors`)

```json
{
  "companyName": "Acme Corp",
  "logo": "assets/images/acme-corp/logo.png",
  "companyEvidence": {
    "careers.acme.com": {
      "sourceDomain": "careers.acme.com",
      "images": [
        {
          "localPath": "assets/images/acme-corp/careers-acme-com/img-001.png",
          "description": "Screenshot of Acme's careers homepage hero section showing the headline 'Build the future with us'.",
          "sourceURL": "https://careers.acme.com"
        }
      ],
      "textualEvidence": [
        {
          "localPath": null,
          "sourceURL": "https://careers.acme.com/why-join",
          "type": "messaging_excerpt",
          "context": "From the Why Join Us page hero",
          "content": {
            "text": "We build products used by millions — and the people who build them get to see that impact every day."
          }
        }
      ]
    },
    "glassdoor.com": {
      "sourceDomain": "glassdoor.com",
      "images": [
        {
          "localPath": "assets/images/acme-corp/glassdoor-com/img-001.png",
          "description": "Glassdoor overview showing overall rating of 4.2 stars.",
          "sourceURL": "https://www.glassdoor.com/Overview/Working-at-Acme-Corp.htm"
        }
      ],
      "textualEvidence": []
    }
  },
  "analysis": {
    "employerValueProposition": {
      "primaryHeadline": {
        "text": "Build the future with us.",
        "sourceURL": "https://careers.acme.com"
      },
      "keyPillarStatements": [
        {
          "statement": "Work on products used by millions of people — and watch your work ship.",
          "sourceURL": "https://careers.acme.com/why-join"
        },
        {
          "statement": "Grow fast with dedicated learning budgets, mentorship, and clear promotion tracks.",
          "sourceURL": "https://careers.acme.com/why-join"
        }
      ],
      "summary": "Acme Corp positions its employer brand squarely around scale and impact — the ability to build products that reach millions. This Impact-first positioning is paired with a strong Opportunity narrative around career progression and learning, making it a compelling proposition for ambitious engineers.",
      "sourceURLs": [
        "https://careers.acme.com",
        "https://careers.acme.com/why-join"
      ]
    },
    "kilosFrameworkAnalysis": {
      "Kinship": {
        "presence": true,
        "summary": "Acme Corp emphasizes inclusivity and psychological safety, with dedicated DEI pages and regular employee spotlights. The culture narrative is people-first and team-oriented.",
        "sourceURLs": ["https://careers.acme.com/culture"],
        "supportingEvidence": [
          {
            "evidenceText": "We believe diverse teams build better products. That's why inclusion is built into how we hire, how we work, and how we lead.",
            "evidenceType": "messaging_excerpt",
            "theme": "Diversity, inclusion, equality",
            "localImagePath": "assets/images/acme-corp/careers-acme-com/img-002.png",
            "sourceURL": "https://careers.acme.com/culture"
          }
        ]
      },
      "Impact": {
        "presence": true,
        "summary": "Impact is Acme's primary messaging pillar. The ability to build products at scale — and see them used by real people — is the dominant theme across the careers website, LinkedIn, and employee testimonials.",
        "sourceURLs": ["https://careers.acme.com", "https://linkedin.com/company/acme-corp"],
        "supportingEvidence": [
          {
            "evidenceText": "Our engineers don't just write code — they build things that millions of people rely on every day.",
            "evidenceType": "messaging_excerpt",
            "theme": "Impact on a big/global scale",
            "localImagePath": null,
            "sourceURL": "https://careers.acme.com/why-join"
          }
        ]
      },
      "Lifestyle": {
        "presence": true,
        "summary": "Acme prominently advertises competitive compensation, flexible remote work policies, and generous benefits. Work-life balance messaging is present but not a primary differentiator.",
        "sourceURLs": ["https://careers.acme.com/benefits"],
        "supportingEvidence": []
      },
      "Opportunity": {
        "presence": true,
        "summary": "Career growth is a key pillar. Acme promotes structured promotion tracks, learning budgets, and internal mobility across geographies and functions.",
        "sourceURLs": ["https://careers.acme.com/why-join"],
        "supportingEvidence": [
          {
            "evidenceText": "$5,000 annual learning budget. Mentorship from Day 1. A promotion process that's clear, transparent, and merit-based.",
            "evidenceType": "messaging_excerpt",
            "theme": "Career progression/opportunities",
            "localImagePath": "assets/images/acme-corp/careers-acme-com/img-003.png",
            "sourceURL": "https://careers.acme.com/why-join"
          }
        ]
      },
      "Status": {
        "presence": true,
        "summary": "Acme leverages its scale and brand recognition as a status signal, referencing industry awards and Top Employer rankings. Heritage messaging is lighter given the company's relative youth.",
        "sourceURLs": ["https://careers.acme.com"],
        "supportingEvidence": []
      }
    },
    "brandVoiceAnalysis": {
      "toneAnchors": [
        {
          "scale": "Funny ↔ Serious",
          "rating": 3,
          "justification": "Acme's voice is balanced — professional but not stiff. Occasional wit in copy (especially on social) without being frivolous.",
          "sourceURLs": ["https://linkedin.com/company/acme-corp"]
        },
        {
          "scale": "Casual ↔ Formal",
          "rating": 2,
          "justification": "Distinctly casual. First-person plural ('we', 'our'), conversational sentences, minimal jargon.",
          "sourceURLs": ["https://careers.acme.com"]
        },
        {
          "scale": "Irreverent ↔ Respectful",
          "rating": 4,
          "justification": "Generally respectful and inclusive. No edgy or provocative positioning.",
          "sourceURLs": ["https://careers.acme.com/culture"]
        },
        {
          "scale": "Emotional ↔ Matter-of-fact",
          "rating": 2,
          "justification": "Leans emotional — 'see your work in the hands of millions' — but grounds it in concrete facts (learning budgets, promo timelines).",
          "sourceURLs": ["https://careers.acme.com/why-join"]
        }
      ],
      "summary": "Acme Corp's brand voice is warm, direct, and confident. It speaks to engineers as peers — not recruits — using 'we' language and concrete proof points. The emotional hook (scale of impact) is always anchored to real specifics, avoiding the hollow inspirationalism common in tech employer branding.",
      "sourceURLs": ["https://careers.acme.com", "https://linkedin.com/company/acme-corp"]
    },
    "employeeSentimentAnalysis": {
      "quantitativeSummary": [
        {
          "platform": "Glassdoor",
          "overallRating": 4.2,
          "numReviews": 3200,
          "recommendToFriendPercent": 85,
          "ceoApprovalPercent": 88,
          "categoryRatings": {
            "Culture & Values": 4.1,
            "Diversity & Inclusion": 4.3,
            "Work-Life Balance": 3.9,
            "Senior Management": 3.7,
            "Compensation & Benefits": 4.4,
            "Career Opportunities": 4.0
          },
          "sourceURL": "https://www.glassdoor.com/Overview/Working-at-Acme-Corp.htm"
        },
        {
          "platform": "Indeed",
          "overallRating": 4.0,
          "numReviews": 1800,
          "recommendToFriendPercent": null,
          "ceoApprovalPercent": null,
          "categoryRatings": {
            "Work-Life Balance": 3.8,
            "Pay & Benefits": 4.2,
            "Job Security": 3.6,
            "Management": 3.7,
            "Culture": 4.0
          },
          "sourceURL": "https://www.indeed.com/cmp/Acme-Corp"
        }
      ],
      "qualitativeThemes_Pros": [
        {
          "reviewQuote": "Fast-paced, smart colleagues, genuinely interesting technical challenges.",
          "theme": "Stimulating work environment",
          "sourceContext": "Glassdoor review by a Senior Engineer, Feb 2026",
          "localImagePath": "assets/images/acme-corp/glassdoor-com/img-002.png",
          "sourceURL": "https://www.glassdoor.com/Overview/Working-at-Acme-Corp.htm"
        }
      ],
      "qualitativeThemes_Cons": [
        {
          "reviewQuote": "Middle management layer can slow things down. Too many meetings.",
          "theme": "Management / process overhead",
          "sourceContext": "Glassdoor review by a Staff Engineer, Jan 2026",
          "localImagePath": null,
          "sourceURL": "https://www.glassdoor.com/Overview/Working-at-Acme-Corp.htm"
        }
      ]
    }
  }
}
```

---

## `comparison`

Cross-company analysis data that drives the Executive Summary, Competition, and KILOS Matrix views.

```json
{
  "comparison": {
    "executiveSummary": {
      "sharedThemes": "Across the competitive landscape, all companies anchor their employer brand in Impact — the ability to work on meaningful products at scale. Kinship (collaboration, inclusion) and Opportunity (career growth, learning) are also near-universal pillars, though the depth of proof points varies considerably.",
      "keyDifferentiators": "Differentiation lives in the specifics. Acme Corp stands out with structured, transparent career progression and a strong scale-of-impact narrative. Competitor B differentiates through an unusually strong wellbeing and work-life balance proposition. Competitor A leans heavily on Status and heritage, trading on its industry-leading brand name as a career asset.",
      "whiteSpaceOpportunities": "No competitor in this set explicitly addresses scientific autonomy or individual researcher influence over company direction — a gap Acme Corp could fill. Additionally, while all companies mention DEI, few provide specific, measurable commitments or employee-led evidence of inclusion culture in action.",
      "sourceURLs": [
        "https://careers.acme.com",
        "https://careers.competitor-a.com",
        "https://careers.competitor-b.com"
      ]
    },
    "comparativePositioningSnapshots": [
      {
        "companyName": "Acme Corp",
        "careersHeadline": "Build the future with us.",
        "cultureExcerpt": "Work on products used by millions. Grow fast with dedicated learning budgets and clear promotion tracks.",
        "sourceURL": "https://careers.acme.com"
      },
      {
        "companyName": "Competitor A",
        "careersHeadline": "Join the world's most trusted tech company.",
        "cultureExcerpt": "80 years of innovation, thousands of patents, and a culture that rewards deep expertise.",
        "sourceURL": "https://careers.competitor-a.com"
      }
    ],
    "kilosMessagingMatrix": [
      {
        "theme": "Diversity, inclusion, equality",
        "dimension": "Kinship",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Present",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "Focus on wellbeing and health",
        "dimension": "Kinship",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Weak",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "Collaboration/teamwork",
        "dimension": "Kinship",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Present",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Treated fairly/with respect",
        "dimension": "Kinship",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Present",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Safe to speak up/voice opinions",
        "dimension": "Kinship",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Weak",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Culture/values",
        "dimension": "Kinship",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Strong",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "Employee testimonials",
        "dimension": "Kinship",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Present",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "For people, society, communities",
        "dimension": "Impact",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Strong",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "On environment or planet",
        "dimension": "Impact",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Present",
          "Competitor B": "Weak"
        }
      },
      {
        "theme": "Empowerment/autonomy",
        "dimension": "Impact",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Weak",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Impact on a big/global scale",
        "dimension": "Impact",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Strong",
          "Competitor B": "Absent"
        }
      },
      {
        "theme": "Able to influence business direction",
        "dimension": "Impact",
        "companyScores": {
          "Acme Corp": "Weak",
          "Competitor A": "Absent",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Transformation and change",
        "dimension": "Impact",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Strong",
          "Competitor B": "Weak"
        }
      },
      {
        "theme": "Innovate and invent",
        "dimension": "Impact",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Strong",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Good benefits/perks",
        "dimension": "Lifestyle",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Present",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "Healthy work-life balance",
        "dimension": "Lifestyle",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Weak",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "Flexibility",
        "dimension": "Lifestyle",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Weak",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "Job security/stability",
        "dimension": "Lifestyle",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Strong",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Tools and resources/tech",
        "dimension": "Lifestyle",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Present",
          "Competitor B": "Weak"
        }
      },
      {
        "theme": "Skills development",
        "dimension": "Opportunity",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Present",
          "Competitor B": "Strong"
        }
      },
      {
        "theme": "Variety and breadth of tasks",
        "dimension": "Opportunity",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Present",
          "Competitor B": "Weak"
        }
      },
      {
        "theme": "Develop your professional expertise",
        "dimension": "Opportunity",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Strong",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Challenge/stretch",
        "dimension": "Opportunity",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Present",
          "Competitor B": "Absent"
        }
      },
      {
        "theme": "Internal mobility/choice of locations",
        "dimension": "Opportunity",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Strong",
          "Competitor B": "Absent"
        }
      },
      {
        "theme": "Career progression/opportunities",
        "dimension": "Opportunity",
        "companyScores": {
          "Acme Corp": "Strong",
          "Competitor A": "Present",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Recognisable brand",
        "dimension": "Status",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Strong",
          "Competitor B": "Weak"
        }
      },
      {
        "theme": "Industry reputation/market position",
        "dimension": "Status",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Strong",
          "Competitor B": "Absent"
        }
      },
      {
        "theme": "Long heritage/legacy",
        "dimension": "Status",
        "companyScores": {
          "Acme Corp": "Absent",
          "Competitor A": "Strong",
          "Competitor B": "Absent"
        }
      },
      {
        "theme": "Recognition as an employer",
        "dimension": "Status",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Strong",
          "Competitor B": "Present"
        }
      },
      {
        "theme": "Voice for societal issues",
        "dimension": "Status",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Weak",
          "Competitor B": "Absent"
        }
      },
      {
        "theme": "Ethics",
        "dimension": "Status",
        "companyScores": {
          "Acme Corp": "Present",
          "Competitor A": "Present",
          "Competitor B": "Absent"
        }
      }
    ]
  }
}
```

---

## Field reference — `companyEvidence[domain]`

| Field | Type | Description |
|-------|------|-------------|
| `sourceDomain` | string | Human-readable domain label shown in the evidence gallery tab (e.g., `"glassdoor.com"`, `"careers.acme.com"`) |
| `images[].localPath` | string | Relative path to the image file from the report folder root |
| `images[].description` | string | Alt text / caption shown below the image in the gallery |
| `images[].sourceURL` | string | URL where this screenshot was captured |
| `textualEvidence[].type` | string | `"messaging_excerpt"`, `"testimonial_quote"`, `"data_metric"`, `"headline"` |
| `textualEvidence[].context` | string | Where this text was found (e.g., "Hero section", "Glassdoor review by Senior Engineer") |
| `textualEvidence[].content.text` | string | The verbatim text content |

## Field reference — KILOS scoring

`kilosFrameworkAnalysis[Pillar]`:

| Field | Type | Description |
|-------|------|-------------|
| `presence` | boolean | `true` = this pillar appears in the company's employer brand messaging |
| `summary` | string | 2–4 sentence analysis of how and how strongly the pillar appears |
| `sourceURLs` | string[] | URLs where evidence was found |
| `supportingEvidence[].evidenceText` | string | Verbatim quote or excerpt |
| `supportingEvidence[].evidenceType` | string | `"messaging_excerpt"` or `"testimonial_quote"` |
| `supportingEvidence[].theme` | string | KILOS sub-theme label (from the 26-theme grid) |
| `supportingEvidence[].localImagePath` | string\|null | Path to screenshot backing this evidence, or null |
| `supportingEvidence[].sourceURL` | string | URL of the source page |

## Tone scale ratings (1–5)

For `brandVoiceAnalysis.toneAnchors[].rating`:

| Scale | 1 | 3 | 5 |
|-------|---|---|---|
| Funny ↔ Serious | Very funny/playful | Balanced | Very serious |
| Casual ↔ Formal | Very casual | Mixed | Very formal |
| Irreverent ↔ Respectful | Very irreverent | Balanced | Very respectful |
| Emotional ↔ Matter-of-fact | Very emotional | Mixed | Very matter-of-fact |
