# Employer Brand Comparative Audit Fixture

## Purpose

This static fixture represents the first Employer Brand comparative audit artifact bundle for the AOS Artifact Bundle Workbench. It is intentionally read-only: it does not run browser collection, generate strategic analysis, execute exports, repair a recipe, or replay a workflow. Its purpose is to prove that a stakeholder-facing Markdown report can travel with source metadata, provenance, Work Record evidence, and a previewable workbench route.

## Scope

The fixture compares Symphony Talent, Phenom, and Radancy through a lightweight KILOS frame. The statements below are fixture claims grounded in the attached source metadata, not a current live-web audit.

| Company | Fixture role | Strongest fixture signal | Evidence note |
| --- | --- | --- | --- |
| Symphony Talent | Client | Opportunity | The fixture source metadata positions career growth, candidate experience, and talent marketing capability as primary comparison inputs. |
| Phenom | Competitor | Impact | The fixture source metadata emphasizes platform transformation and AI-enabled talent experience as the comparative signal. |
| Radancy | Competitor | Status | The fixture source metadata emphasizes enterprise scale, global reach, and brand activation as the comparative signal. |

## KILOS Snapshot

| Dimension | Symphony Talent | Phenom | Radancy | Fixture implication |
| --- | --- | --- | --- | --- |
| Kinship | Present | Present | Weak | Culture and belonging signals need more direct source evidence before a polished audit can score them confidently. |
| Impact | Present | Strong | Present | Phenom reads as the clearest impact-led competitor in this static sample. |
| Lifestyle | Weak | Present | Weak | Benefits, flexibility, and wellbeing claims are under-evidenced in this fixture and should be collected from careers-specific sources in a real audit. |
| Opportunity | Strong | Present | Present | Symphony Talent has the strongest fixture signal around growth, enablement, and candidate journey improvement. |
| Status | Present | Present | Strong | Radancy carries the strongest status signal through enterprise-scale positioning. |

## Source Evidence

The attached `sources.json` file records one source reference per company, the fixture role, source URL, source status, and the limitation that this fixture does not include fresh browser captures. A production run should attach source text, screenshots, collection timestamps, and normalized excerpts before elevating these findings into a client-facing report.

## Provenance

This fixture is guided by the 2026-05-05 Employer Brand demo postmortem and the Artifact Bundle workbench direction. The postmortem identified two gaps this fixture addresses in a small, non-generative slice: stable artifact identity and visible evidence handoff. The linked Work Record captures those claims as verifier-readable evidence.

## Readiness Notes

This report is acceptable as a workbench fixture when the Artifact Bundle Workbench can preview the Markdown artifact, inspect `sources.json`, open the linked Work Record through the existing Work Record Workbench path, and hydrate the Work Record evidence summary after handoff.
