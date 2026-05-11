#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const fixture = path.join(repoRoot, 'docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html')

function usage() {
  return 'Usage: node scripts/browser-dom-element-picker-surface-smoke.mjs [--stdout] [--headed]'
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { stdout: false, headless: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--stdout') args.stdout = true
    else if (arg === '--headed') args.headless = false
    else if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return args
}

async function importPlaywright() {
  try {
    return await import('playwright')
  } catch {
    const which = spawnSync('which', ['playwright'], { encoding: 'utf8' })
    if (which.status !== 0 || !which.stdout.trim()) {
      throw new Error('playwright module is not importable and playwright command is unavailable')
    }
    const cliPath = fs.realpathSync(which.stdout.trim())
    const scopedRoot = path.resolve(path.dirname(cliPath), '..')
    const result = spawnSync(process.execPath, [
      '-e',
      `console.log(require.resolve('playwright', { paths: [${JSON.stringify(scopedRoot)}] }))`,
    ], { encoding: 'utf8' })
    if (result.status !== 0 || !result.stdout.trim()) {
      throw new Error(`Unable to resolve global playwright module: ${result.stderr || result.stdout}`)
    }
    return import(pathToFileURL(result.stdout.trim()).href)
  }
}

function browserSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    .replace(/import[\s\S]*?from '\.\/annotation-projection\.js'\n\n/, '')
    .replace(/import[\s\S]*?from '\.\/browser-dom-element-picker\.js'\n\n/, '')
    .replace(/^export /gm, '')
}

async function run(args) {
  const playwright = await importPlaywright()
  const chromium = playwright.chromium || playwright.default?.chromium
  if (!chromium) throw new Error('playwright chromium export is unavailable')
  const browser = await chromium.launch({ headless: args.headless })
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  try {
    await page.goto(pathToFileURL(fixture).href)
    if (!page.url().startsWith('file:') || !page.url().endsWith('/controlled-page.html')) {
      throw new Error(`unexpected browser URL: ${page.url()}`)
    }
    await page.addScriptTag({
      content: `(() => {
${browserSource('packages/toolkit/workbench/annotation-projection.js')}
${browserSource('packages/toolkit/workbench/browser-dom-element-picker.js')}
${browserSource('packages/toolkit/workbench/controlled-browser-dom-surface.js')}
window.__surfacePublisher = installControlledBrowserDomSurfacePublisher(document, {
  source_path: 'docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html',
  source_url: document.location.href,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  now: '2026-05-10T00:00:00.000Z'
});
})()`,
    })
    const summary = await page.evaluate(() => {
      const publisher = window.__surfacePublisher
      const initial = publisher.publish({ reason: 'initial' })
      const replay = publisher.onMessage({
        type: 'canvas_inspector.semantic_targets.request',
        request_id: 'late-si-attach',
        reason: 'late_surface_inspector_attach',
        requested_at: '2026-05-10T00:00:00.000Z',
      })
      const hero = replay.semantic_targets.find((target) => target.preferred_selector === '[data-testid="hero-card"]')
      const offscreen = replay.semantic_targets.find((target) => target.preferred_selector === '#offscreen-target')
      const visibleReveal = publisher.revealTarget(hero)
      const offscreenReveal = publisher.revealTarget(offscreen)
      return {
        schema: 'browser_dom_surface_smoke',
        version: '0.1.0',
        status: 'passed',
        source_url: document.location.href,
        assertions: {
          local_fixture_only: document.location.protocol === 'file:' && document.location.pathname.endsWith('/controlled-page.html'),
          initial_publish_has_targets: initial.semantic_targets.length >= 3,
          late_attach_replayed: replay.request_id === 'late-si-attach' && replay.publish_count === 2,
          hero_card_projectable: hero?.surface_type === 'browser_page' && hero?.preferred_selector === '[data-testid="hero-card"]',
          offscreen_revealable: offscreen?.metadata?.visibility?.can_reveal === true && offscreen?.metadata?.visibility?.state !== 'visible',
          visible_reveal_already_visible: visibleReveal.status === 'already_visible',
          offscreen_revealed: offscreenReveal.status === 'revealed',
          tooling_dom_not_published: !replay.semantic_targets.some((target) => target.selector_candidates?.includes('[data-aos-dom-picker-overlay]')),
        },
        publish_count: replay.publish_count,
        hero,
        offscreen,
        visible_reveal: visibleReveal,
        offscreen_reveal: offscreenReveal,
      }
    })
    if (Object.values(summary.assertions).some((value) => value !== true)) {
      summary.status = 'failed'
      throw new Error(JSON.stringify(summary, null, 2))
    }
    return summary
  } finally {
    await browser.close()
  }
}

try {
  const summary = await run(parseArgs())
  if (process.argv.includes('--stdout')) console.log(JSON.stringify(summary, null, 2))
  else console.log(`browser DOM Surface Inspector smoke ${summary.status}; publish_count=${summary.publish_count}`)
} catch (error) {
  console.error(error?.message || String(error))
  process.exit(1)
}
