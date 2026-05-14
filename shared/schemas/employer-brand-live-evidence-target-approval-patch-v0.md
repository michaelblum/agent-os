# Employer Brand Live Evidence Target Approval Patch v0

This schema records human review decisions for a Live Evidence Target Review Pack.
It is data-only planning provenance: it can approve, reject, keep draft, or edit
target text fields before a derived reviewed target plan is generated.

V0 does not authorize live browser collection, URL reachability checks, locator
resolution, codegen execution, screenshots, clip generation, report rendering,
HTML/CSS polish, PDF/DOCX export, workflow execution, or full-page grabs.

The patch edits only target planning fields: desired element/target element,
evidence goal, KILOS relevance, expected clip count, acceptance criteria, notes,
and review status. Rejected targets are excluded from the derived reviewed target
plan so later readiness counts and expected clip totals do not include them.
