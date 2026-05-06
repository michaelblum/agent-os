# AOS Workbench Subject v-next Sketch

Status: design sketch. The live JSON Schema remains
[`aos-workbench-subject.schema.json`](aos-workbench-subject.schema.json) with
`schema_version: "2026-05-03"`, and now accepts the optional v-next
compatibility fields described here.

This sketch records the target shape that follows ADR-0001 through ADR-0010:
Subjects remain stable units of identity, Facets are concrete projections inside
Layers, Facets declare Host implementations, Capabilities are high-level
contracts, and dotted operation strings move toward `contracts[]`.

## Compatibility Goals

- Keep the current required identity fields: `type`, `schema_version`, `id`,
  `subject_type`, `label`, and `owner`.
- Add optional fields first: `facets[]`, `subject_references[]`, `contracts[]`,
  and structured verification metadata.
- Keep `views[]` and `controls[]` during migration as legacy summaries.
- Preserve current helpers until consumers can read the v-next fields.

## Top-Level Shape

```json
{
  "type": "aos.workbench.subject",
  "schema_version": "2026-05-next",
  "id": "subject-id",
  "subject_type": "domain.kind",
  "label": "Human label",
  "owner": "owning-system",
  "source": {},
  "capabilities": ["inspectable"],
  "contracts": [],
  "subject_references": [],
  "facets": [],
  "persistence": null,
  "artifacts": [],
  "verification": null,
  "state": {},
  "metadata": {},
  "views": [],
  "controls": []
}
```

`source` identifies the Subject's source of truth or descriptor source. It is
not a relationship to another Subject. Cross-Subject relationships use
`subject_references[]`.

`capabilities[]` uses the registry in
[`aos-subject-capabilities.md`](aos-subject-capabilities.md). Dotted operation
or event contracts should move to `contracts[]`.

`views[]` and `controls[]` remain compatibility fields for the 2026-05-03
helpers. New consumers should derive openable views and operations from
`facets[]`, `capabilities[]`, and `contracts[]`.

## Subject References

A Subject Reference is a typed relationship from this Subject, or one of its
Facets, to another Subject or Facet.

```json
{
  "id": "sigil-narrative-doc",
  "relationship": "narrative_source",
  "handle": "wiki:Sigil",
  "subject_id": "wiki:sigil/index.md",
  "subject_type": "wiki.entity",
  "facet_key": "wiki",
  "layer": "narrative",
  "role": "source"
}
```

Field notes:

- `id` is local to the containing Subject.
- `relationship` is a typed relation such as `narrative_source`,
  `describes`, `child_subject`, `generated_from`, `guided_by`, or
  `evidence_for`.
- `handle` is a Subject Entry Handle. The resolver owns its grammar.
- `subject_id`, `subject_type`, `facet_key`, and `layer` are optional resolved
  cache fields. Consumers must not treat them as a substitute for resolving the
  handle when freshness matters.
- `role` describes how the containing Subject uses the reference.

## Facets

A Facet is a concrete, addressable projection of one Layer of one Subject.

```json
{
  "key": "markdown-source",
  "layer": "narrative",
  "label": "Markdown",
  "source": {
    "kind": "wiki",
    "path": "sigil/index.md"
  },
  "source_ref": null,
  "capabilities": ["inspectable", "editable"],
  "contracts": ["markdown_document.text.patch"],
  "hosts": [
    {
      "kind": "browser",
      "target_dialect": "browser",
      "entry": {
        "kind": "route",
        "value": "/wiki/sigil/index.md"
      },
      "preferred": true
    },
    {
      "kind": "canvas",
      "target_dialect": "canvas",
      "entry": {
        "kind": "aos-url",
        "value": "aos://toolkit/components/markdown-workbench/index.html"
      }
    }
  ]
}
```

Field notes:

- `key` is stable within the Subject.
- `layer` is one of the Layer taxonomy names: `narrative`, `descriptor`,
  `controls`, `artifacts`, or `health`. Work Record descriptors may use
  `execution_map` as a descriptor-layer specialization and `evidence` as an
  artifacts-layer specialization in examples, but the Layer taxonomy remains the
  same.
- `source` is the Facet-local source if it differs from the Subject source.
- `source_ref` points to an entry in `subject_references[]` when this Facet is
  backed by another Subject or Facet.
- `capabilities` narrows which top-level Capabilities this Facet helps satisfy.
- `contracts` lists operation contracts supported by this Facet.
- `hosts[]` lists one or more Host implementations. A single `host` enum is too
  coarse because each Host can have different entry points and fidelity.

## Host Entries

```json
{
  "kind": "browser",
  "target_dialect": "browser",
  "entry": {
    "kind": "route",
    "value": "/subjects/sigil"
  },
  "preferred": true,
  "browser_compatible": true,
  "notes": "Uses data-aos-ref and ARIA controls."
}
```

`kind` is the Host kind (`browser` or `canvas` today). `target_dialect` is the
AOS target dialect the Host exposes. `entry` is deliberately typed because
Browser Hosts may use routes while Canvas Hosts may use `aos://` component URLs
or runtime canvas ids.

## Example: Wiki Document Subject

A wiki document stays a wiki-oriented Subject. It does not become `sigil.agent`
because it documents Sigil.

```json
{
  "type": "aos.workbench.subject",
  "schema_version": "2026-05-next",
  "id": "wiki:sigil/index.md",
  "subject_type": "wiki.entity",
  "label": "Sigil",
  "owner": "wiki",
  "source": {
    "kind": "wiki",
    "path": "sigil/index.md",
    "namespace": "aos"
  },
  "capabilities": ["inspectable", "editable"],
  "contracts": ["markdown_document.text.patch", "wiki.invoke"],
  "subject_references": [],
  "facets": [
    {
      "key": "wiki",
      "layer": "narrative",
      "label": "Markdown",
      "source": {
        "kind": "wiki",
        "path": "sigil/index.md"
      },
      "capabilities": ["inspectable", "editable"],
      "contracts": ["markdown_document.text.patch"],
      "hosts": [
        {
          "kind": "browser",
          "target_dialect": "browser",
          "entry": {
            "kind": "route",
            "value": "/wiki/sigil/index.md"
          },
          "preferred": true
        },
        {
          "kind": "canvas",
          "target_dialect": "canvas",
          "entry": {
            "kind": "aos-url",
            "value": "aos://toolkit/components/markdown-workbench/index.html"
          }
        }
      ]
    },
    {
      "key": "outline",
      "layer": "descriptor",
      "label": "Outline",
      "contracts": [],
      "hosts": [
        {
          "kind": "browser",
          "target_dialect": "browser",
          "entry": {
            "kind": "route",
            "value": "/wiki/sigil/index.md?facet=outline"
          }
        }
      ]
    }
  ],
  "views": ["source", "markdown.preview", "outline"],
  "controls": ["text.editor", "save", "revert"]
}
```

## Example: Sigil Domain Subject

The domain Subject has its own identity and references the wiki document as the
source for its narrative Facet.

```json
{
  "type": "aos.workbench.subject",
  "schema_version": "2026-05-next",
  "id": "sigil:app",
  "subject_type": "sigil.agent",
  "label": "Sigil",
  "owner": "sigil",
  "source": {
    "kind": "repo",
    "path": "apps/sigil"
  },
  "capabilities": ["inspectable", "editable", "exportable"],
  "contracts": ["sigil.radial_menu.read", "sigil.radial_menu.patch"],
  "subject_references": [
    {
      "id": "sigil-narrative-doc",
      "relationship": "narrative_source",
      "handle": "wiki:Sigil",
      "subject_id": "wiki:sigil/index.md",
      "subject_type": "wiki.entity",
      "facet_key": "wiki",
      "layer": "narrative",
      "role": "source"
    }
  ],
  "facets": [
    {
      "key": "narrative",
      "layer": "narrative",
      "label": "Overview",
      "source_ref": "sigil-narrative-doc",
      "capabilities": ["inspectable"],
      "hosts": [
        {
          "kind": "browser",
          "target_dialect": "browser",
          "entry": {
            "kind": "subject-reference",
            "value": "sigil-narrative-doc"
          },
          "preferred": true
        }
      ]
    },
    {
      "key": "radial-menu-descriptor",
      "layer": "descriptor",
      "label": "Radial Menu Descriptor",
      "source": {
        "kind": "repo",
        "path": "apps/sigil/radial-menu.json"
      },
      "contracts": ["sigil.radial_menu.read"],
      "hosts": [
        {
          "kind": "browser",
          "target_dialect": "browser",
          "entry": {
            "kind": "route",
            "value": "/subjects/sigil/radial-menu"
          }
        }
      ]
    },
    {
      "key": "radial-menu-editor",
      "layer": "controls",
      "label": "Radial Menu Editor",
      "capabilities": ["editable"],
      "contracts": ["sigil.radial_menu.patch"],
      "hosts": [
        {
          "kind": "browser",
          "target_dialect": "browser",
          "entry": {
            "kind": "route",
            "value": "/subjects/sigil/radial-menu/edit"
          },
          "preferred": true
        },
        {
          "kind": "canvas",
          "target_dialect": "canvas",
          "entry": {
            "kind": "aos-url",
            "value": "aos://sigil/radial-menu-workbench"
          }
        }
      ]
    }
  ],
  "views": ["overview", "radial-menu.descriptor"],
  "controls": ["radial-menu.editor"]
}
```

The repo paths above are illustrative schema examples. A live helper must use
the actual source-of-truth path for the descriptor it emits.

## Open Schema Decisions

- Whether the new schema field should be named `subject_references[]`,
  `references[]`, or `links[]`.
- Whether `contracts[]` should stay a string list or become structured records
  with `id`, `kind`, `version`, and `schema_ref`.
- Whether `facets[].capabilities` is useful or redundant once Facets already
  list `layer` and `contracts`.
- How Subject Entry Handles should encode subjects whose canonical ids already
  contain a colon, such as `wiki:<path>`.
- How Playbook step postconditions promote into Work Record Claims.
