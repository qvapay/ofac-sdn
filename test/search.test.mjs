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

	it('folds the Latin letters NFD leaves whole to their ASCII spelling', () => {
		assert.equal(normalize('ŁUKASZENKA, Łukasz'), 'lukaszenka lukasz')
		assert.equal(normalize('Al-Qaida på Den Arabiske Halvø'), 'al qaida pa den arabiske halvo')
		assert.equal(normalize('Đorđević'), 'dordevic')
		// Ð (capital eth) looks exactly like Đ
		assert.equal(normalize('ÐORÐEVIĆ'), 'dordevic')
		assert.equal(normalize('Organisation für äußere Sicherheit'), 'organisation fur aussere sicherheit')
		assert.equal(normalize('STRAUẞ'), 'strauss')
		assert.equal(normalize('Palæstinensisk Islamisk Jihad'), 'palaestinensisk islamisk jihad')
		assert.equal(normalize('Police des mœurs'), 'police des moeurs')
		assert.equal(normalize('Il-Ġiħad Iżlamika'), 'il gihad izlamika')
		assert.equal(normalize('İslami Büyük Doğu Akıncılar Cephesi'), 'islami buyuk dogu akincilar cephesi')
	})
})

describe('score', () => {
	it('matches a Cyrillic query against the listed Cyrillic alias', () => {
		assert.equal(score('Путин Владимир', 'ПУТИН, Владимир'), 100)
	})

	it('scores a name typed in plain ASCII at 100 against its listed spelling, and the other way round', () => {
		assert.equal(score('Lukaszenka Aliaksandr', 'ŁUKASZENKA, Aliaksandr'), 100)
		assert.equal(score('Đorđević Vlastimir', 'DORDEVIC, Vlastimir'), 100)
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
		{ id: '4', type: 'Individual', programs: ['BALKANS'], names: [{ full: 'DJORDJEVIC, Vlastimir', isPrimary: true }, { full: 'DORDEVIC, Vlastimir', isPrimary: false }] },
		{ id: '5', type: 'Entity', programs: ['SDGT'], names: [{ full: 'Rewolucyjna Organizacja Muzułmańskich Socjalistów', isPrimary: true }] },
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

	it('finds a name listed in ASCII when it is typed with its own letters', async () => {
		const { results } = await searchName('Đorđević Vlastimir')
		assert.equal(results[0]?.entity.id, '4')
		assert.equal(results[0]?.score, 100)
	})

	it('finds a name listed with those letters when it is typed in plain ASCII', async () => {
		const { results } = await searchName('Rewolucyjna Organizacja Muzulmanskich Socjalistow')
		assert.equal(results[0]?.entity.id, '5')
		assert.equal(results[0]?.score, 100)
	})
})
