# AOS Subject Model Compatibility Audit

**Status:** Closed audit; current contract summarized below.

Wiki documents remain wiki-oriented Subjects. Domain Subjects are separate,
consumer-owned descriptors related to source documents through top-level
`subject_references[]`. A Subject's `subject_type` names its stable kind and
does not change with the workbench or Host that opens it.

Live AOS writers emit high-level `capabilities[]`, operation/event strings in
`contracts[]`, concrete `facets[]`, `facets[].hosts[]`, and top-level
`subject_references[]`. They omit legacy `views[]` and `controls[]`. Reader-only
compatibility for archived descriptors remains centralized in the generic
subject helpers.

Product-specific domain projections belong in the external product repository.
AOS toolkit owns only generic Subject, Facet, Host, reference, and workbench
builders.
