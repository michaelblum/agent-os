#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const defaultFixture = path.join(repoRoot, 'docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html')
const defaultOut = path.join(repoRoot, 'docs/design/fixtures/browser-dom-element-picker-v0/element-target-record.json')

function usage() {
  return `Usage: node scripts/browser-dom-element-picker-smoke.mjs [--fixture <controlled-page.html>] [--out <record.json>] [--stdout] [--headed]`
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    fixture: defaultFixture,
    out: defaultOut,
    stdout: false,
    headless: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--fixture') {
      args.fixture = path.resolve(argv[index + 1])
      index += 1
    } else if (arg === '--out') {
      args.out = path.resolve(argv[index + 1])
      index += 1
    } else if (arg === '--stdout') {
      args.stdout = true
    } else if (arg === '--headed') {
      args.headless = false
    } else if (arg === '--help' || arg === '-h') {
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

function browserPickerSource() {
  const sourcePath = path.join(repoRoot, 'packages/toolkit/workbench/browser-dom-element-picker.js')
  return fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[\s\S]*?from '\.\/annotation-projection\.js'\n\n/, '')
    .replace(/^export /gm, '')
}

async function runSmoke(args) {
  const playwright = await importPlaywright()
  const chromium = playwright.chromium || playwright.default?.chromium
  if (!chromium) throw new Error('playwright chromium export is unavailable')

  const browser = await chromium.launch({ headless: args.headless })
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  try {
    await page.goto(pathToFileURL(args.fixture).href)
    await page.addScriptTag({
      content: `(() => {
${browserPickerSource()}
window.buildBrowserDomElementTargetRecord = buildBrowserDomElementTargetRecord;
installBrowserDomElementPicker(document, {
  surface_id: 'controlled-browser-page',
  source_path: ${JSON.stringify(path.relative(repoRoot, args.fixture))},
  source_url: document.location.href,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  now: '2026-05-10T00:00:00.000Z',
});
})()`,
    })

    const box = await page.locator('#stable-cta').boundingBox()
    if (!box) throw new Error('controlled fixture #stable-cta did not produce a bounding box')
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const result = await page.evaluate(({ x, y }) => {
      const picker = window.__aosDomElementPicker
      picker.hoverAt(x, y)
      const hover = structuredClone(window.__aosDomElementPickerState)
      picker.contextClickAt(x, y)
      const ancestorPicker = structuredClone(window.__aosDomElementPickerState)
      picker.hoverAncestor(1)
      const preview = structuredClone(window.__aosDomElementPickerState)
      picker.commitAncestor(1, { ordinal: 1, actor: { role: 'human', id: 'operator' } })
      const committed = structuredClone(window.__aosDomElementPickerState)
      const offscreen = buildBrowserDomElementTargetRecord(document.querySelector('#offscreen-target'), {
        surface_id: 'controlled-browser-page',
        source_url: document.location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        now: '2026-05-10T00:00:00.000Z',
      })
      return { hover, ancestorPicker, preview, committed, offscreen }
    }, point)

    const record = result.committed.committed_element_target
    const summary = {
      schema: 'browser_dom_element_picker_smoke',
      version: '0.1.0',
      status: 'passed',
      fixture: path.relative(repoRoot, args.fixture),
      assertions: {
        hover_expected_deepest_element: result.hover.hover_candidate?.tag_name === 'button',
        ancestor_picker_contains_parent_chain: result.ancestorPicker.ancestor_picker?.options?.map((item) => item.descriptor.tag_name).join('>') === 'button>section>main>body',
        committed_broader_ancestor: record?.tag_name === 'section' && record?.kind === 'element_target',
        stable_selector_candidate: record?.selector_candidates?.includes('[data-testid="hero-card"]') === true,
        offscreen_reveal_modeled: result.offscreen.metadata?.visibility?.can_reveal === true
          && result.offscreen.metadata?.visibility?.state !== 'visible',
      },
      record,
      offscreen_record: result.offscreen,
      picker_state: result.committed,
    }
    if (Object.values(summary.assertions).some((value) => value !== true)) {
      summary.status = 'failed'
      throw new Error(JSON.stringify(summary, null, 2))
    }
    fs.mkdirSync(path.dirname(args.out), { recursive: true })
    fs.writeFileSync(args.out, `${JSON.stringify(record, null, 2)}\n`)
    return summary
  } finally {
    await browser.close()
  }
}

try {
  const args = parseArgs()
  const summary = await runSmoke(args)
  if (args.stdout) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`wrote ${path.relative(repoRoot, args.out)}`)
  }
} catch (error) {
  console.error(error?.message || String(error))
  process.exit(1)
}
