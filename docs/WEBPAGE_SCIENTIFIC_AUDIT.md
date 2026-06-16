# HYDRA-EO scientific webpage audit

Audit date: 2026-06-10  
Baseline reviewed: current `index.html`, `explorer.html`, Quarto pages, visualization catalog, import workflow, security guidance, and public assets.

## Executive assessment

The baseline is approximately **3.5/10 as a complete scientific project website**. It contains credible project facts, useful methods material, and a technically ambitious Explorer, but the homepage does not yet communicate the project as a coherent ESA scientific programme. The Explorer appears after four science sections instead of directly after the hero, formal project facts are buried, research questions and data governance are absent, outputs are not structured, consortium responsibilities are vague, and news mixes past events with future-tense copy.

Scientific trust is also weakened by claims that read as achieved outcomes without linked validation evidence, asset captions that can be mistaken for measurements, incomplete metadata in the catalog, and a tracked raster that conflicts with the intended large-data publishing policy. The page is maintained as a large HTML file with extensive inline CSS, inline JavaScript, inline event handlers, and duplicated prose.

## Dimension audit

### Scientific clarity

- **Current score: 4/10**
- **Main problems:** The research problem is repeated across hero, overview, mission, goals, and methods without explicit research questions. Detection, differentiation, early-warning, operational, and decision-support language is stronger than the evidence exposed on the site. Trait lists and named algorithms are presented without a distinction between planned methods and validated outputs.
- **Required fixes:** State the scientific problem once, add five research questions, distinguish planned work from available evidence, and replace outcome language with testable project aims.
- **Expected score after fixes: 9.6/10**

### Project credibility

- **Current score: 5/10**
- **Main problems:** ESA action, start date, duration, coordinator, and partners exist but are visually buried. The first screen uses long promotional paragraphs and does not provide a formal project status or evidence-readiness statement.
- **Required fixes:** Add concise ESA identity, status strip, formal factsheet, explicit evidence status, acknowledgement, and project disclaimer.
- **Expected score after fixes: 9.7/10**

### Information architecture

- **Current score: 3/10**
- **Main problems:** Current order is hero, overview, mission/crops, goals, methods, Explorer, news, consortium, tools, tutorials, contact. This contradicts the required narrative and leaves data, outputs, observation strategy, and roadmap without dedicated sections.
- **Required fixes:** Rebuild in the 14-block order mandated by `PLAN.md`; make the Explorer the second major content block.
- **Expected score after fixes: 10/10**

### Visual hierarchy

- **Current score: 4/10**
- **Main problems:** Multiple sections reuse similar card grids and headings, so important distinctions are lost. The Explorer preview is too late and comparatively small. News and tutorials consume more visual space than project governance and outputs. Inline styling makes visual emphasis inconsistent.
- **Required fixes:** Introduce a consistent scientific design system, varied section layouts appropriate to content, strong section numbering, prominent Explorer cockpit, factsheet, matrix, scale chain, readiness ladder, roadmap, and formal closing block.
- **Expected score after fixes: 9.6/10**

### Explorer / visualization value

- **Current score: 7/10**
- **Main problems:** The dedicated Explorer includes modes, swipe, lens, band composer, inspector, provenance, and figure controls, but the homepage placement is wrong and the preview does not clearly expose the generated catalog status. Mode labels do not fully match the required terminology. Some current catalog assets are observational, synthetic, example, methodological, or unverified, which requires clearer class labelling.
- **Required fixes:** Move a substantial evidence-cockpit preview directly below the hero; share readiness language with the data section; retain disabled states and strict computation gates; link to the full Explorer.
- **Expected score after fixes: 9.6/10**

### Dataset and provenance communication

- **Current score: 5/10**
- **Main problems:** Provenance is present inside the catalog and Explorer, but no homepage section explains the data boundary, metadata contract, COG/STAC policy, or readiness levels. Catalog entries include missing acquisition dates, calibration, licenses, and nodata. A TIFF is present under a browser asset folder despite the new policy to avoid exposing heavy source rasters.
- **Required fixes:** Add a dedicated data-governance section and readiness ladder; make missing metadata explicit; ensure generated status fields summarize the catalog; keep raw/heavy products out of public paths; document external hosting.
- **Expected score after fixes: 9.7/10**

### Methods communication

- **Current score: 5/10**
- **Main problems:** The method is a prose list, not an auditable chain from inputs to validation and outputs. It names RF, boosting, CNNs, and Gaussian processes without showing whether these are selected, planned, or validated. Uncertainty and harmonization are underdeveloped.
- **Required fixes:** Present inputs, RTM layer, observations, retrieval, hybrid ML, attribution, validation/uncertainty, and outputs as a connected workflow; identify ToolsRTM and SCOPEinR as enabling software.
- **Expected score after fixes: 9.6/10**

### Crop-stressor experiment communication

- **Current score: 5/10**
- **Main problems:** Four crop cards exist, but status, responsible partner, evidence products, caveats, and metadata availability are absent. Some detailed pathogen/treatment claims are not linked to public protocols and could be read as confirmed dataset labels. Image captions such as disease/stress labels can be mistaken for measured classifications.
- **Required fixes:** Use a structured crop-stressor matrix; label details as project design where supported; mark data status and metadata limitations; avoid coordinates, treatment counts, measured values, or inferred labels.
- **Expected score after fixes: 9.5/10**

### Tools and reproducibility

- **Current score: 6/10**
- **Main problems:** ToolsRTM, SCOPEinR, repository links, and copyable examples exist, but tutorials are detached from a reproducibility pathway. The Shiny application is described as active without a public project-specific endpoint. Catalog/import instructions are not integrated into the homepage.
- **Required fixes:** Group tools and tutorials by RTM, SCOPE, visualization, and catalog workflow; label planned interfaces honestly; preserve copy controls; link validation and import commands.
- **Expected score after fixes: 9.5/10**

### Consortium and roles

- **Current score: 4/10**
- **Main problems:** Partner cards emphasize logos and generic descriptions. Roles, work packages, crop systems, and scientific contributions are not consistently structured. Work-package information exists only in a separate Quarto timeline.
- **Required fixes:** Add partner role cards, a country collaboration strip without invented coordinates, and a structured WP1-WP10 overview using existing project text.
- **Expected score after fixes: 9.5/10**

### News/events freshness

- **Current score: 3/10**
- **Main problems:** February 2026 events are still written in future tense on 2026-06-10. Upcoming and past items are mixed. Expired vacancy material remains in source content. Event contributions outside the project scope are not clearly separated.
- **Required fixes:** Separate Upcoming and Past, show the required empty state, archive February 2026 events as past, remove expired recruitment callouts, and make no new event claims.
- **Expected score after fixes: 9.5/10**

### Publications and outputs

- **Current score: 2/10**
- **Main problems:** There is no formal outputs architecture. Presentations appear inside news, while papers, datasets, software releases, deliverables, and roadmap are not separated. Publication status is ambiguous.
- **Required fixes:** Add six explicit output categories; state that accepted peer-reviewed outputs will be listed when available; distinguish available software from planned releases and project roadmap phases.
- **Expected score after fixes: 9.6/10**

### Accessibility

- **Current score: 5/10**
- **Main problems:** Mobile navigation exists, but the toggle lacks a complete accessible state, inline click handlers reduce keyboard/state clarity, focus styles are inconsistent, and status changes are not systematically announced. Some text is small and uppercase with wide tracking.
- **Required fixes:** Use semantic links/buttons, `aria-expanded`, visible focus states, skip link, live status, descriptive disabled controls, reduced-motion support, and responsive tables/cards.
- **Expected score after fixes: 9.5/10**

### Performance

- **Current score: 5/10**
- **Main problems:** The homepage has more than a thousand lines of inline CSS and an inline script. A public raster is tracked in the site tree. Google Fonts creates an external dependency and the current CSP allows broad inline execution/styles.
- **Required fixes:** Move homepage CSS and JS into modular files, use system fonts, keep the homepage Explorer lightweight, lazy-load images, and prevent large raster bundling.
- **Expected score after fixes: 9.4/10**

### Security

- **Current score: 6/10**
- **Main problems:** Stage-2 security work is strong, but the homepage still contains inline event handlers and a permissive CSP with `'unsafe-inline'` scripts. Validation does not scan inline handlers or `insertAdjacentHTML`. Raw/heavy extension ignore rules are incomplete relative to the plan.
- **Required fixes:** Remove inline handlers and giant inline script, tighten CSP, expand dangerous-pattern checks, enforce URL and raw-folder policy, complete archive extension rules, and retain hardened external links.
- **Expected score after fixes: 9.6/10**

### Maintainability

- **Current score: 3/10**
- **Main problems:** Homepage layout, design system, content, and behavior are coupled in one large HTML file. There are legacy Quarto and versioned pages with duplicated content, multiple overlapping Explorer scripts, and two stage-specific reports instead of the plan's final audit/report artifacts.
- **Required fixes:** Create dedicated homepage CSS and site JS, keep Explorer modules separate, make the Python validator enforce architecture, and document authoritative versus legacy surfaces.
- **Expected score after fixes: 9.5/10**

### Mobile experience

- **Current score: 5/10**
- **Main problems:** A mobile menu exists, but the dense hero, large card collections, inline dimensions, code blocks, and late Explorer produce a long, uneven experience. The scientific matrix and readiness concepts have no mobile treatment because they do not yet exist.
- **Required fixes:** Build responsive single-column fallbacks, horizontal-safe tables, touch-sized controls, compact navigation, and a mobile Explorer preview that preserves readiness and provenance.
- **Expected score after fixes: 9.5/10**

## Explicit content and integrity findings

- **Duplicated/weak text:** “Understanding crop stress across scales” is repeated; hero, overview, mission, and goals restate the same promise.
- **Stale dates:** 2-5 February 2026 and 10-12 February 2026 events are past as of 10 June 2026 but are written as upcoming.
- **Typos/broken labels:** `airborne-borne`; spacing/grammar errors in code comments; blank contact heading; inconsistent `HYDRA-E0`/`HYDRA-EO` repository naming; legacy content contains `Next comming events`, `Shiny applicaiton`, and fluorescence spelling errors.
- **Vague or unsupported claims:** “operational framework”, “early and reliable indicators”, “deliver decision-support applications”, and validation/detection wording are not supported by publication-ready evidence on the public site.
- **Missing sections:** project-at-a-glance, research questions, observation strategy, data/readiness, outputs/roadmap, structured work packages, and formal acknowledgement/disclaimer.
- **Bad order:** Explorer is not second; tools and consortium are separated from their narrative roles; news precedes consortium and tools.
- **Underweighted content:** project facts, experimental design, governance, outputs, roles, and acknowledgement.
- **Overweight content:** repeated mission prose, generic goals cards, news, and long inline tutorials.
- **Metadata gaps:** acquisition dates, calibration, atmospheric correction, license, complete nodata, validation, and publication readiness are missing for current assets.
- **Output gaps:** no authoritative paper, dataset release, software release, deliverable, and roadmap registry.
- **Security gaps:** inline event handlers; `'unsafe-inline'` script CSP; incomplete validator coverage; incomplete heavy-extension ignore policy.
- **Fake/placeholder risk:** Existing synthetic/example/unverified catalog entries are explicitly labelled, but disease/stress image captions and strong outcome copy can be misread as measured results. No new scientific value should be inferred or generated.

## Redesign decision

The rebuild will retain verified administrative facts and documented methods, but it will replace the homepage hierarchy and wording. It will treat crop/stressor details as experimental design, not results; expose catalog status without inventing values; keep all computations disabled unless the metadata contract passes; and direct full evidence inspection to the dedicated Explorer.
