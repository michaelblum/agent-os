# Employer Brand Human Locator Approval Patch v0

This schema records explicit human/operator locator decisions for items in the
Human Locator Review Pack. It is the only planning path that can promote a
target from ambiguous or human-review-needed locator states to `locator_ready`.

The patch is data-only. It may approve or edit a selector, provide XPath, provide
a Playwright locator, refine the natural-language target, mark blocked, keep
draft, or reject a target. It does not open URLs, execute locators, run codegen,
capture screenshots, generate clips, render reports, export files, run
workflows, crawl autonomously, or bypass site controls.
