import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { normalize, score } from '../lib/scoring.js'

describe('normalize', () => {
	it('keeps letters of non-Latin scripts', () => {
		assert.equal(normalize('ЛУКАШЕНКО, Александр Григорьевич'), 'лукашенко александр григорьевич')
		// OFAC wraps right-to-left names in bidi controls (RLE … PDF); written as escapes so they stay visible
		assert.equal(normalize('\u202Bبانک مرکزی جمهوری اسلامی ایران\u202C'), 'بانک مرکزی جمهوری اسلامی ایران')
	})

	it('keeps the whole name when a Latin prefix precedes Cyrillic', () => {
		assert.equal(normalize('OOO ЦЕНТР ОБРАБОТКИ'), 'ooo центр обработки')
	})

	it('still strips accents and punctuation from Latin names', () => {
		assert.equal(normalize("José AL-QA'IDA  Núñez"), 'jose al qa ida nunez')
	})
})

describe('score', () => {
	it('matches a Cyrillic query against the listed Cyrillic alias', () => {
		assert.equal(score('Путин Владимир', 'ПУТИН, Владимир'), 100)
	})

	it('does not give an unrelated company a perfect score through its legal-form prefix', () => {
		assert.ok(score('OOO Romashka', 'OOO ЦЕНТР ОБРАБОТКИ ЭЛЕКТРОННЫХ ПЛАТЕЖЕЙ') < 100)
	})
})

describe('searchName', () => {
	const entities = [
		{ id: '1', type: 'Individual', programs: ['RUSSIA-EO14024'], names: [{ full: 'PUTIN, Vladimir', isPrimary: true }, { full: 'ПУТИН, Владимир', isPrimary: false }] },
		// Another Cyrillic company with the same legal-form prefix: both used to collapse to "ooo"
		{ id: '3', type: 'Entity', programs: ['BELARUS-EO14038'], names: [{ full: 'OOO ГРОСВЕР ГРУП', isPrimary: true }] },
		{ id: '2', type: 'Entity', programs: ['RUSSIA-EO14024'], names: [{ full: 'OOO ЦЕНТР ОБРАБОТКИ ЭЛЕКТРОННЫХ ПЛАТЕЖЕЙ', isPrimary: true }] },
	]
	let server
	let searchName

	before(async () => {
		server = createServer((_, res) => res.end(JSON.stringify({ entities })))
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
		process.env.OFAC_INDEX_URL = `http://127.0.0.1:${server.address().port}/ofac-entities.json`
		;({ searchName } = await import('../lib/search.js'))
	})

	after(() => server.close())

	it('finds a sanctioned person queried in Cyrillic', async () => {
		const { total, results } = await searchName('Путин Владимир')
		assert.ok(total > 0)
		assert.equal(results[0].entity.id, '1')
		assert.equal(results[0].score, 100)
	})

	it('finds an entity by its exact listed Cyrillic name, ahead of others sharing its prefix', async () => {
		const { results } = await searchName('OOO ЦЕНТР ОБРАБОТКИ ЭЛЕКТРОННЫХ ПЛАТЕЖЕЙ')
		assert.equal(results[0]?.entity.id, '2')
		assert.equal(results[0]?.score, 100)
		assert.ok(results.slice(1).every((r) => r.score < 100))
	})
})
