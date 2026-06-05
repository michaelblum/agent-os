#!/usr/bin/env node
// fallow-extract.js — turn a fallow JSON dump into an actionable digest.
// Usage:  node fallow-extract.js <file.json> [pkgPrefix1,pkgPrefix2,...]
// Default prefixes: packages/toolkit,apps/sigil
// Envelope-aware: handles a combined run (dead-code + dupes + health) OR a
// `dupes`-only run (fallow dupes -f json). For dupes-only files it prints just
// the WET digest.
const fs = require("fs");
const file = process.argv[2] || "/tmp/fallow.json";
const PREFIXES = (process.argv[3] || "packages/toolkit,apps/sigil").split(",").map(s=>s.trim()).filter(Boolean);

let raw = fs.readFileSync(file, "utf8");
const i = raw.indexOf("{"); if (i > 0) raw = raw.slice(i);   // strip npm/preamble noise
let d; try { d = JSON.parse(raw); } catch (e) { console.error("PARSE FAIL:", e.message); process.exit(1); }

// Envelope detection: dupes data may be nested (combined) or at root (dupes-only).
const check = d.check || null, health = d.health || null;
const dupes = d.dupes || (d.clone_groups ? d : null);
const findings = (health && health.findings) || [];
const targets  = (health && health.targets)  || [];
const fileScores = (health && health.file_scores) || [];

const allPaths = [...((check&&check.unused_files)||[]), ...findings].map(x => x.path || "");
const matched = PREFIXES.filter(p => allPaths.some(pp => pp.startsWith(p)));
const scopes = matched.length ? matched : [""];
const label = s => s || "(whole run)";
const inScope = (p, s) => s === "" || (p||"").startsWith(s);
const h = t => console.log("\n"+"=".repeat(72)+"\n"+t+"\n"+"=".repeat(72));
const sub = t => console.log("\n--- "+t+" ---");
const dirOf = p => (p||"").split("/").slice(0,-1).join("/");

// ---------------------------------------------------------------- run integrity
if (check || health) {
  h("RUN INTEGRITY (verify BEFORE trusting dead-code)");
  const ep = (check&&check.entry_points)||{}, hs=(health&&health.hotspot_summary)||{}, vs=(health&&health.vital_signs)||{};
  console.log("fallow version      :", d.version);
  console.log("entry_points.total  :", ep.total, ep.total===0 ? "  <-- ZERO: dead-code is a CONFIG ARTIFACT" : "");
  console.log("entry_point sources :", JSON.stringify(ep.sources||{}));
  console.log("coverage_model      :", (health&&health.summary||{}).coverage_model, "  (static_estimated => CRAP==cyclomatic; rank by cognitive/cyclomatic, NOT CRAP)");
  console.log("hotspot files_analyzed:", hs.files_analyzed, hs.files_analyzed===0 ? "  <-- no git churn; do NOT label 'critical path'" : "");
  console.log("dead_file_pct       :", vs.dead_file_pct, " dead_export_pct:", vs.dead_export_pct,
    "  (NOTE: a valid quality signal for APPS; for platform libraries unconsumed surface is EXPECTED)");
  console.log("total_issues        :", check&&check.total_issues);
}

// ------------------------------------------------------------------ WET digest
function wet(groups, title) {
  if (!groups || !groups.length) { console.log("(no clone groups)"); return; }
  const enrich = g => {
    const inst = g.instances || [];
    const dirs = new Set(inst.map(x => dirOf(x.file)));
    return { g, inst, crossDir: dirs.size > 1, n: inst.length, lines: g.line_count||0 };
  };
  const all = groups.map(enrich);
  sub(title + " — most widespread (by occurrence count, then size)");
  all.slice().sort((a,b)=> b.n-a.n || b.lines-a.lines).slice(0,12).forEach(({g,inst,crossDir,n,lines})=>{
    console.log(`  ${crossDir?"● cross-dir":"· local    "}  x${n}  ${lines}L  [${g.fingerprint||""}]`);
    inst.forEach(x=>console.log(`        ${x.file}:${x.start_line}-${x.end_line}`));
  });
  sub(title + " — largest single clones (by line_count)");
  all.slice().sort((a,b)=> b.lines-a.lines).slice(0,8).forEach(({g,inst,crossDir,n,lines})=>{
    console.log(`  ${crossDir?"● cross-dir":"· local    "}  ${lines}L  x${n}  ${inst.map(x=>x.file+":"+x.start_line).join("  ||  ")}`);
  });
}
if (dupes) {
  h("WET / DUPLICATION" + (check||health ? " (whole run)" : " (dupes-only run)"));
  const ds = dupes.stats||{};
  console.log(`groups=${ds.clone_groups} instances=${ds.clone_instances} duplicated=${(ds.duplication_percentage||0).toFixed(2)}% (${ds.duplicated_lines}/${ds.total_lines} lines)`);
  console.log("● = clone spans >1 directory (architectural WET, worth consolidating)  · = same-dir (often local copy-paste)");
  wet(dupes.clone_groups, "clones");
}

// ---------------------------------------------------------------- per scope
for (const s of (check||health ? scopes : [])) {
  h("PACKAGE: " + label(s));

  if (check) {
    const uf = (check.unused_files||[]).filter(x=>inScope(x.path,s));
    const ux = (check.unused_exports||[]).filter(x=>inScope(x.path,s));
    sub("dead code  [VALID for apps; INFORMATIONAL ONLY for platform libraries]");
    console.log(`unused_files=${uf.length}  unused_exports=${ux.length} (re-exports=${ux.filter(x=>x.is_re_export).length}, likely public API)  unused_types=${(check.unused_types||[]).filter(x=>inScope(x.path,s)).length}`);
    sub("dependency hygiene (higher-confidence — but void if total_deps=0 / node_modules absent)");
    const ud=check.unused_dependencies||[], ul=check.unlisted_dependencies||[], ur=check.unresolved_imports||[];
    console.log("unused_dependencies:", ud.length?ud.map(x=>x.package_name).join(", "):"none");
    console.log("unlisted_dependencies:", ul.length?ul.map(x=>x.package_name).join(", "):"none");
    console.log("unresolved_imports:", ur.length?ur.filter(x=>inScope(x.path,s)).map(x=>`${x.specifier} (in ${x.path}:${x.line})`).join(" | ")||"none":"none");
    sub("circular dependencies");
    const cyc=(check.circular_dependencies||[]).filter(c=>(c.files||[]).some(f=>inScope(f,s)));
    cyc.length?cyc.forEach(c=>console.log(`  (len ${c.length}) `+(c.files||[]).join(" -> ")+" -> [start]")):console.log("none");
  }

  if (health) {
    sub("complexity hotspots (top 10 by COGNITIVE — 'hardest to follow'; cyclomatic in parens)");
    findings.filter(f=>inScope(f.path,s)).sort((a,b)=>b.cognitive-a.cognitive).slice(0,10)
      .forEach(f=>console.log(`  cog=${f.cognitive} cyc=${f.cyclomatic} loc=${f.line_count} params=${f.param_count}  ${f.name} @ ${f.path}:${f.line}`));

    sub("long parameter lists (param_count >= 5 — refactor-to-options-object smell)");
    const lp = findings.filter(f=>inScope(f.path,s) && f.param_count>=5).sort((a,b)=>b.param_count-a.param_count).slice(0,10);
    lp.length?lp.forEach(f=>console.log(`  params=${f.param_count}  ${f.name} @ ${f.path}:${f.line}`)):console.log("none");

    sub("least-maintainable files (lowest maintainability_index)");
    fileScores.filter(f=>inScope(f.path,s)).sort((a,b)=>a.maintainability_index-b.maintainability_index).slice(0,8)
      .forEach(f=>console.log(`  MI=${f.maintainability_index} density=${f.complexity_density} cyc=${f.total_cyclomatic} cog=${f.total_cognitive} loc=${f.lines}  ${f.path}`));

    sub("top 10 fallow targets by priority");
    targets.filter(t=>inScope(t.path,s)).sort((a,b)=>b.priority-a.priority).slice(0,10)
      .forEach(t=>console.log(`  prio=${t.priority} effort=${t.effort} conf=${t.confidence} [${t.category}] ${t.recommendation} (${t.path})`));
  }
}
