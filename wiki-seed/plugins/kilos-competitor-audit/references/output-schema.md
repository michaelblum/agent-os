---
type: concept
name: KILOS Competitor Audit Output Schema
description: Provenance-aware JSON contract for employer brand competitor audits, including evidence registry and cross-company analysis.
tags: [kilos, employer-brand, schema, evidence, json]
---

# Output Schema — KILOS Competitor Audit

The competitor audit produces a single structured JSON file. Every quote, data point, and analysis finding carries an `evidence_id` that maps back to the top-level `evidence_registry`. The registry ties each finding to a concrete artifact bundle entry, which in turn carries the source URL.

**Provenance chain:**

```
finding
  → evidence_id  (e.g., "sanofi_careers_why_join::swcjob_003")
    → evidence_registry entry
      → request_id  (planning identity)
      → capture_job_id  (execution identity)
      → url  (human-readable source context)
```

URL is retained as metadata on every citation for readability and debugging. It is not the primary identity key.

---

## Top-Level Structure

```json
{
  "audit_metadata": { ... },
  "evidence_registry": [ ... ],
  "companies": {
    "[company_slug]": { ... }
  },
  "cross_company_analysis": { ... }
}
```

---

## audit_metadata

```json
{
  "audit_metadata": {
    "audit_id": "sanofi_hubs_2026_03_14",
    "client": "Sanofi",
    "audit_date": "2026-03-14",
    "competitors": ["Roche", "Novartis", "GSK", "AstraZeneca"],
    "regions": ["Global", "Budapest", "Hyderabad"],
    "manifest_ref": "sanofi-audit-manifest-2026-03-14.yaml",
    "notes": "SSC/Hub-specific messaging captured where available. Some Glassdoor category detail required sign-in — operator collected via headed browser."
  }
}
```

---

## evidence_registry

The evidence registry is built from the artifact bundle returned by Studio. It is the canonical provenance layer. Every content field that cites a source references an `evidence_id` from this registry.

One `request_id` may have multiple entries (retries, refreshes, or alternate captures), each with a distinct `capture_job_id`.

```json
{
  "evidence_registry": [
    {
      "evidence_id": "sanofi_careers_home::swcjob_001",
      "request_id": "sanofi_careers_home",
      "capture_job_id": "swcjob_001",
      "url": "https://www.sanofi.com/en/careers",
      "capture_type": "navigate",
      "artifacts": {
        "screenshot": "artifacts/sanofi_careers_home_swcjob_001_screenshot.png",
        "page_text": "artifacts/sanofi_careers_home_swcjob_001_text.txt",
        "page_source": "artifacts/sanofi_careers_home_swcjob_001.html"
      },
      "operator_notes": null,
      "replay_hints": null,
      "collected_at": "2026-03-14T09:15:00Z"
    },
    {
      "evidence_id": "sanofi_careers_why_join::swcjob_002",
      "request_id": "sanofi_careers_why_join",
      "capture_job_id": "swcjob_002",
      "url": "https://jobs.sanofi.com/en/why-join-us",
      "capture_type": "navigate",
      "artifacts": {
        "screenshot": "artifacts/sanofi_careers_why_join_swcjob_002_screenshot.png",
        "page_text": "artifacts/sanofi_careers_why_join_swcjob_002_text.txt",
        "page_source": "artifacts/sanofi_careers_why_join_swcjob_002.html"
      },
      "operator_notes": "Hero section captured in first screenshot. Scrolled to awards section for second capture.",
      "replay_hints": {
        "scroll_pause_ms": 800,
        "wait_for_selector": ".why-join-hero"
      },
      "collected_at": "2026-03-14T09:18:00Z"
    },
    {
      "evidence_id": "sanofi_careers_ssc::swcjob_003",
      "request_id": "sanofi_careers_ssc",
      "capture_job_id": "swcjob_003",
      "url": "https://jobs.sanofi.com/en/career-hubs",
      "capture_type": "navigate",
      "artifacts": {
        "screenshot": "artifacts/sanofi_careers_ssc_swcjob_003_screenshot.png",
        "page_text": "artifacts/sanofi_careers_ssc_swcjob_003_text.txt",
        "page_source": null
      },
      "operator_notes": "SSC-specific page confirmed. Lists Budapest and Hyderabad hub locations.",
      "replay_hints": null,
      "collected_at": "2026-03-14T09:22:00Z"
    },
    {
      "evidence_id": "sanofi_glassdoor::swcjob_007",
      "request_id": "sanofi_glassdoor",
      "capture_job_id": "swcjob_007",
      "url": "https://www.glassdoor.com/Overview/Working-at-Sanofi-EI_IE14888.htm",
      "capture_type": "navigate",
      "artifacts": {
        "screenshot": "artifacts/sanofi_glassdoor_swcjob_007_screenshot.png",
        "page_text": "artifacts/sanofi_glassdoor_swcjob_007_text.txt",
        "page_source": null
      },
      "operator_notes": "Signed in before capture. Category ratings visible. Review excerpts captured by scrolling.",
      "replay_hints": {
        "requires_login": true,
        "platform": "glassdoor"
      },
      "collected_at": "2026-03-14T09:45:00Z"
    }
  ]
}
```

### Evidence registry fields

| Field | Type | Description |
|-------|------|-------------|
| `evidence_id` | string | Primary key. Format: `[request_id]::[capture_job_id]` |
| `request_id` | string | Planning identity — the manifest entry this satisfies |
| `capture_job_id` | string | Execution identity — the specific Studio job run |
| `url` | string | Source URL — retained as human-readable metadata |
| `capture_type` | `"navigate"` \| `"run_instruction"` | How the capture was executed |
| `artifacts` | object | Paths to collected files (screenshot, page_text, page_source). Null if not captured. |
| `operator_notes` | string \| null | Notes added by the Studio operator during collection |
| `replay_hints` | object \| null | Hints for rerunning this capture. Null until populated post-run. |
| `collected_at` | string (ISO 8601) | Timestamp of collection |

---

## Citation shape

Every quote, rating, data point, and analysis finding in the output uses this citation shape:

```json
{
  "text": "Pursue progress. Discover extraordinary.",
  "evidence_id": "sanofi_careers_why_join::swcjob_002",
  "url": "https://jobs.sanofi.com/en/why-join-us"
}
```

Where a field could not be populated because evidence was not collected:

```json
{
  "value": null,
  "evidence_unavailable": true,
  "missing_request_id": "sanofi_glassdoor"
}
```

---

## companies[slug]

Each company is keyed by a lowercase slug (e.g., `"sanofi"`, `"astrazeneca"`).

```json
{
  "name": "Sanofi",
  "careers_website": { ... },
  "social_media": { ... },
  "employee_reviews": { ... },
  "brand_voice": { ... },
  "kilos_mapping": { ... },
  "brand_archetype": { ... }
}
```

---

### careers_website

```json
{
  "careers_website": {
    "global_url": {
      "url": "https://www.sanofi.com/en/careers",
      "evidence_id": "sanofi_careers_home::swcjob_001"
    },
    "headline": {
      "text": "Pursue progress. Discover extraordinary.",
      "evidence_id": "sanofi_careers_why_join::swcjob_002",
      "url": "https://jobs.sanofi.com/en/why-join-us"
    },
    "secondary_headline": {
      "text": "Work wonders, every day.",
      "evidence_id": "sanofi_careers_why_join::swcjob_002",
      "url": "https://jobs.sanofi.com/en/why-join-us"
    },
    "evp": {
      "what_you_get": {
        "text": "A diverse mix of people, the chance to create your own opportunities and the freedom to make them happen and flourish.",
        "evidence_id": "sanofi_careers_why_join::swcjob_002",
        "url": "https://jobs.sanofi.com/en/why-join-us"
      },
      "what_you_give": {
        "text": "Bring your ambition, the eagerness to explore new ideas, and embrace new opportunities and cultures.",
        "evidence_id": "sanofi_careers_why_join::swcjob_002",
        "url": "https://jobs.sanofi.com/en/why-join-us"
      }
    },
    "brand_differentiators": [
      {
        "theme_label": "Skills development & Career progression",
        "kilos_pillar": "Opportunity",
        "quotes": [
          {
            "text": "Build a career with purpose. Your development is a team effort and we're here to support you every step of the way.",
            "evidence_id": "sanofi_careers_why_join::swcjob_002",
            "url": "https://jobs.sanofi.com/en/why-join-us"
          }
        ]
      },
      {
        "theme_label": "Focus on wellbeing and health",
        "kilos_pillar": "Kinship",
        "quotes": [
          {
            "text": "We support healthy bodies, healthy minds, healthy financials, and a healthy working culture for all Sanofi employees.",
            "evidence_id": "sanofi_careers_why_join::swcjob_002",
            "url": "https://jobs.sanofi.com/en/why-join-us"
          }
        ]
      }
    ],
    "ssc_specific": {
      "page_url": {
        "url": "https://jobs.sanofi.com/en/career-hubs",
        "evidence_id": "sanofi_careers_ssc::swcjob_003"
      },
      "page_name": "Career Hubs",
      "messaging_samples": [
        {
          "theme_label": "Internal mobility/choice of locations",
          "kilos_pillar": "Opportunity",
          "quotes": [
            {
              "text": "A career in our Hubs has multiple paths for your development, working across Finance, People Services, Digital, Commercial.",
              "evidence_id": "sanofi_careers_ssc::swcjob_003",
              "url": "https://jobs.sanofi.com/en/career-hubs"
            }
          ]
        }
      ]
    },
    "awards": [
      {
        "award": "World Economic Forum Skills Lighthouse (one of only 20 worldwide)",
        "evidence_id": "sanofi_careers_why_join::swcjob_002",
        "url": "https://jobs.sanofi.com/en/why-join-us"
      }
    ]
  }
}
```

---

### social_media

```json
{
  "social_media": {
    "linkedin": {
      "profile_url": "https://www.linkedin.com/company/sanofi/",
      "evidence_id": "sanofi_linkedin::swcjob_004",
      "followers": 4000000,
      "followers_observed_date": "2026-03-14",
      "channel_type": "professional",
      "messaging_themes": ["Diversity, inclusion, equality", "Impact on a big/global scale"],
      "sample_content": [
        {
          "text": "Did you know that just 29% of autistic people are employed? As a Disability Confident Employer, we're working hard to change how people think about disabilities in the workplace.",
          "evidence_id": "sanofi_linkedin::swcjob_004",
          "url": "https://www.linkedin.com/company/sanofi/",
          "post_url": "https://www.linkedin.com/posts/sanofi_autismawarenessweek-activity-123456",
          "observed_date": "2026-03-14"
        }
      ],
      "notes": "No SSC-specific employer brand content found on LinkedIn."
    },
    "twitter_x": {
      "profile_url": "https://twitter.com/sanofi",
      "evidence_id": "sanofi_twitter::swcjob_005",
      "followers": 152000,
      "followers_observed_date": "2026-03-14",
      "channel_type": "cultural",
      "messaging_themes": ["Impact on a big/global scale", "Innovate and invent"],
      "sample_content": [
        {
          "text": "We're all in on AI. In a conversation with @TEDTalks, our CEO Paul Hudson shared it's time for businesses to harness AI to achieve the extraordinary.",
          "evidence_id": "sanofi_twitter::swcjob_005",
          "url": "https://twitter.com/sanofi",
          "post_url": "https://twitter.com/sanofi/status/123456",
          "observed_date": "2026-03-14"
        }
      ],
      "notes": "Twitter/X selected as cultural channel over Facebook/Instagram based on higher follower count."
    }
  }
}
```

---

### employee_reviews

```json
{
  "employee_reviews": {
    "glassdoor": {
      "profile_url": "https://www.glassdoor.com/Overview/Working-at-Sanofi-EI_IE14888.htm",
      "evidence_id": "sanofi_glassdoor::swcjob_007",
      "overall_rating": 4.0,
      "num_reviews": 11000,
      "pct_recommend": 80,
      "ceo_approval_pct": 82,
      "positive_business_outlook_pct": 65,
      "category_ratings": {
        "culture_and_values": {
          "rating": 3.8,
          "evidence_id": "sanofi_glassdoor::swcjob_007"
        },
        "diversity_and_inclusion": {
          "rating": 4.1,
          "evidence_id": "sanofi_glassdoor::swcjob_007"
        },
        "work_life_balance": {
          "rating": 3.8,
          "evidence_id": "sanofi_glassdoor::swcjob_007"
        },
        "senior_management": {
          "rating": 3.5,
          "evidence_id": "sanofi_glassdoor::swcjob_007"
        },
        "compensation_and_benefits": {
          "rating": 3.9,
          "evidence_id": "sanofi_glassdoor::swcjob_007"
        },
        "career_opportunities": {
          "rating": 3.6,
          "evidence_id": "sanofi_glassdoor::swcjob_007"
        }
      },
      "top_area": {
        "label": "Diversity and inclusion",
        "evidence_id": "sanofi_glassdoor::swcjob_007"
      },
      "bottom_area": {
        "label": "Senior management",
        "evidence_id": "sanofi_glassdoor::swcjob_007"
      },
      "review_highlights": {
        "pros": [
          {
            "text": "Good benefit [401k match and vacation days]",
            "frequency_note": "in 712 reviews",
            "evidence_id": "sanofi_glassdoor::swcjob_007",
            "url": "https://www.glassdoor.com/Overview/Working-at-Sanofi-EI_IE14888.htm"
          }
        ],
        "cons": [
          {
            "text": "Senior leadership doesn't have a clear vision of where it wants to take the company.",
            "frequency_note": "in 91 reviews",
            "evidence_id": "sanofi_glassdoor::swcjob_007",
            "url": "https://www.glassdoor.com/Overview/Working-at-Sanofi-EI_IE14888.htm"
          }
        ]
      },
      "data_date": "2026-03-14"
    },
    "indeed": {
      "profile_url": "https://www.indeed.com/cmp/Sanofi",
      "evidence_id": "sanofi_indeed::swcjob_008",
      "overall_rating": 4.0,
      "num_reviews": 5000,
      "category_ratings": {
        "work_life_balance": {
          "rating": 3.9,
          "evidence_id": "sanofi_indeed::swcjob_008"
        },
        "salary_benefits": {
          "rating": 4.0,
          "evidence_id": "sanofi_indeed::swcjob_008"
        },
        "job_security_advancement": {
          "rating": 3.5,
          "evidence_id": "sanofi_indeed::swcjob_008"
        },
        "management": {
          "rating": 3.6,
          "evidence_id": "sanofi_indeed::swcjob_008"
        },
        "culture": {
          "rating": 3.8,
          "evidence_id": "sanofi_indeed::swcjob_008"
        }
      },
      "top_area": {
        "label": "Salary and benefits",
        "evidence_id": "sanofi_indeed::swcjob_008"
      },
      "bottom_area": {
        "label": "Job security and advancement",
        "evidence_id": "sanofi_indeed::swcjob_008"
      },
      "data_date": "2026-03-14"
    }
  }
}
```

---

### brand_voice

```json
{
  "brand_voice": {
    "tone_of_voice": {
      "funny_to_serious": {
        "score": 4,
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002",
          "sanofi_linkedin::swcjob_004"
        ]
      },
      "casual_to_formal": {
        "score": 3,
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002",
          "sanofi_linkedin::swcjob_004"
        ]
      },
      "irreverent_to_respectful": {
        "score": 4,
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002"
        ]
      },
      "emotional_to_matter_of_fact": {
        "score": 2,
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002",
          "sanofi_linkedin::swcjob_004"
        ]
      },
      "overall_label": "Meaningful and welcoming"
    },
    "visual_identity": {
      "photography_style": {
        "description": "People-focused; extensive use of employee videos and photos across careers website and social media",
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002",
          "sanofi_careers_ssc::swcjob_003",
          "sanofi_linkedin::swcjob_004"
        ]
      },
      "color_scheme": {
        "primary": "#4A154B",
        "secondary": "#7B2D8B",
        "accents": ["white", "black"],
        "description": "White and dark purple backgrounds with purple buttons, accents, and patterns",
        "evidence_ids": [
          "sanofi_careers_home::swcjob_001",
          "sanofi_careers_why_join::swcjob_002"
        ]
      },
      "overall_summary": {
        "text": "Sanofi's eye-catching purple colour scheme combined with people-based photography and video testimonials creates a dynamic candidate experience that pairs a technocentric outlook with warmth.",
        "evidence_ids": [
          "sanofi_careers_home::swcjob_001",
          "sanofi_careers_why_join::swcjob_002",
          "sanofi_careers_ssc::swcjob_003"
        ]
      }
    }
  }
}
```

---

### kilos_mapping

For each theme marked `"present"` or `"sm_only"`, at least one evidence citation is required. Themes that are `"absent"` do not require evidence.

```json
{
  "kilos_mapping": {
    "careers_website_global": {
      "Diversity, inclusion, equality": {
        "status": "present",
        "evidence": [
          {
            "text": "Equality starts with all of us.",
            "evidence_id": "sanofi_careers_why_join::swcjob_002",
            "url": "https://jobs.sanofi.com/en/why-join-us"
          }
        ]
      },
      "Innovate and invent": {
        "status": "present",
        "evidence": [
          {
            "text": "Our ambition is to become the first pharma company powered by artificial intelligence at scale.",
            "evidence_id": "sanofi_careers_why_join::swcjob_002",
            "url": "https://jobs.sanofi.com/en/why-join-us"
          }
        ]
      },
      "Collaboration/teamwork": {
        "status": "absent",
        "evidence": []
      },
      "Voice for societal issues": {
        "status": "sm_only",
        "evidence": [
          {
            "text": "We're proud to announce that the #MeningitisFlag has received the #Impact2024 label from @Paris2024.",
            "evidence_id": "sanofi_twitter::swcjob_005",
            "url": "https://twitter.com/sanofi"
          }
        ]
      }
    },
    "careers_website_ssc": {
      "Internal mobility/choice of locations": {
        "status": "present",
        "evidence": [
          {
            "text": "A career in our Hubs has multiple paths for your development.",
            "evidence_id": "sanofi_careers_ssc::swcjob_003",
            "url": "https://jobs.sanofi.com/en/career-hubs"
          }
        ]
      }
    },
    "linkedin": {
      "Diversity, inclusion, equality": {
        "status": "present",
        "evidence": [
          {
            "text": "Did you know that just 29% of autistic people are employed?",
            "evidence_id": "sanofi_linkedin::swcjob_004",
            "url": "https://www.linkedin.com/company/sanofi/"
          }
        ]
      }
    }
  }
}
```

---

### brand_archetype

```json
{
  "brand_archetype": {
    "primary": "Magician",
    "secondary": null,
    "rationale": {
      "text": "With 'Pursue progress. Discover extraordinary' as its headline and 'Work wonders, every day' as a secondary tagline, Sanofi's positioning is rooted in transformation and innovation. Its ambition to become 'the first pharma company powered by AI at scale' reinforces this Magician archetype.",
      "evidence_ids": [
        "sanofi_careers_home::swcjob_001",
        "sanofi_careers_why_join::swcjob_002"
      ]
    }
  }
}
```

---

## cross_company_analysis

Each insight includes `evidence_ids` pointing to the specific artifact bundle entries that support it.

```json
{
  "cross_company_analysis": {
    "gaps": [
      {
        "title": "No status-themed messaging on the client's global careers website",
        "detail": "All key pharma competitors have some form of recognition or industry-reputation messaging on their careers sites. Sanofi is the only company in this set not to include status messaging.",
        "affected_company": "sanofi",
        "competitors_doing_it": ["roche", "novartis", "gsk"],
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002",
          "roche_careers_why_join::swcjob_015",
          "novartis_careers_why_join::swcjob_028",
          "gsk_careers_why_join::swcjob_041"
        ],
        "supporting_quote": {
          "text": "Roche uses global employer awards to demonstrate recognition — LinkedIn Top Companies 2023, Science Magazine Top Employer for R&D 2022.",
          "evidence_id": "roche_careers_why_join::swcjob_015",
          "url": "https://careers.roche.com/global/en/why-roche"
        }
      }
    ],
    "commonalities": [
      {
        "title": "All companies highlight DEI across multiple touchpoints",
        "detail": "Diversity, equity and inclusion is now a baseline expectation, not a differentiator. Seven of nine companies explicitly call out DEI on their careers website and/or social media.",
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002",
          "roche_careers_why_join::swcjob_015",
          "novartis_careers_why_join::swcjob_028"
        ],
        "supporting_quote": null
      }
    ],
    "differences": [
      {
        "title": "Spotlighting impact is common, but how it is demonstrated varies",
        "detail": "Roche, Novartis, and GSK reference CSR initiatives and patient numbers. Sanofi emphasizes personal career impact but stops short of a broader societal narrative.",
        "evidence_ids": [
          "sanofi_careers_why_join::swcjob_002",
          "roche_careers_why_join::swcjob_015",
          "novartis_careers_why_join::swcjob_028",
          "gsk_careers_why_join::swcjob_041"
        ],
        "supporting_quote": {
          "text": "Roche: 'Together we embrace the unique power of each person to transform the lives of patients & society.'",
          "evidence_id": "roche_careers_why_join::swcjob_015",
          "url": "https://careers.roche.com/global/en/why-roche"
        }
      }
    ],
    "brand_observations": [
      {
        "title": "In a sea of corporate visual identities, Novartis and Sanofi inject warmth",
        "detail": "Novartis uses bold colour and short headlines. Sanofi uses people-based photography and employee video testimonials to humanize a technically complex brand.",
        "evidence_ids": [
          "sanofi_careers_home::swcjob_001",
          "sanofi_careers_why_join::swcjob_002",
          "novartis_careers_home::swcjob_025"
        ],
        "supporting_quote": null
      }
    ],
    "standout_differentiators": [
      {
        "company": "novartis",
        "differentiator": "Empowerment/autonomy messaging ('unbossed leadership')",
        "kilos_theme": "Impact",
        "evidence_ids": [
          "novartis_careers_why_join::swcjob_028"
        ],
        "supporting_quote": {
          "text": "We want you to feel valued and respected, feel free to speak your mind, and grow to your full potential.",
          "evidence_id": "novartis_careers_why_join::swcjob_028",
          "url": "https://www.novartis.com/careers/why-novartis"
        }
      }
    ]
  }
}
```

---

## File Naming Convention

```
[client-slug]-competitor-audit-[YYYY-MM-DD].json
```

Examples:
- `sanofi-hubs-competitor-audit-2026-03-14.json`
- `novartis-competitor-audit-2026-03-14.json`
