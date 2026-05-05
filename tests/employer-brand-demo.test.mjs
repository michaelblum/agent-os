import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReportData, classifyKilos } from '../Employer_Brand_Audit/scripts/employer-brand-demo.mjs'

test('classifyKilos maps visible employer-brand signals into demo ratings', () => {
  const result = classifyKilos('Our inclusive culture helps teams belong, grow careers, and make an impact through innovation.')
  const byDimension = Object.fromEntries(result.map((entry) => [entry.dimension, entry]))
  assert.equal(byDimension.Kinship.rating, 'Present')
  assert.equal(byDimension.Impact.rating, 'Present')
  assert.equal(byDimension.Opportunity.rating, 'Present')
})

test('buildReportData creates report shell data from browser collection records', () => {
  const run = {
    client: { name: 'ClientCo', urls: ['https://client.example/careers'] },
    competitors: [{ name: 'RivalCo', urls: ['https://rival.example/careers'] }],
  }
  const records = [
    {
      status: 'collected',
      company: 'ClientCo',
      url: 'https://client.example/careers',
      domain: 'client.example',
      title: 'ClientCo Careers',
      headline: 'Grow your career and make an impact',
      text: 'Grow your career with learning, mentorship, innovation, and impact for customers.',
      screenshot: 'artifacts/demo/latest/clientco/client-example.png',
    },
    {
      status: 'collected',
      company: 'RivalCo',
      url: 'https://rival.example/careers',
      domain: 'rival.example',
      title: 'RivalCo Careers',
      headline: 'Inclusive teams and flexible work',
      text: 'Our inclusive team culture supports belonging, flexibility, wellness, and benefits.',
      screenshot: 'artifacts/demo/latest/rivalco/rival-example.png',
    },
  ]
  const data = buildReportData(records, run)
  assert.equal(data.client.companyName, 'ClientCo')
  assert.equal(data.competitors[0].companyName, 'RivalCo')
  assert.equal(data.comparison.kilosMessagingMatrix.length, 5)
  assert.equal(data.client.companyEvidence['client.example'].images[0].sourceURL, 'https://client.example/careers')
})
