// UK Sanctions List (FCDO) parser: shape of the runtime entities and the birth-date ranges a reviewer compares.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseUkSanctionsXml, parseUkDate } from '../scripts/sources/uk.mjs'

const XML = `<?xml version="1.0" encoding="utf-8"?>
<Designations>
	<DateGenerated>12/11/2026</DateGenerated>
	<Designation>
		<UniqueID>AFG0006</UniqueID>
		<OFSIGroupID>7172</OFSIGroupID>
		<Names>
			<Name><Name1>MOHAMMAD</Name1><Name2>HASSAN</Name2><Name6>AKHUND</Name6><NameType>Primary Name</NameType></Name>
			<Name><Name6>Mullah Hassan</Name6><NameType>Alias</NameType></Name>
		</Names>
		<NonLatinNames><NonLatinName><NameNonLatinScript>محمد حسن آخوند</NameNonLatinScript></NonLatinName></NonLatinNames>
		<RegimeName>The Afghanistan (Sanctions) (EU Exit) Regulations 2020</RegimeName>
		<IndividualEntityShip>Individual</IndividualEntityShip>
		<Addresses><Address><AddressLine6>Kabul</AddressLine6><AddressCountry>Afghanistan</AddressCountry></Address></Addresses>
		<IndividualDetails><Individual>
			<DOBs><DOB>dd/mm/1945</DOB><DOB>14/03/1946</DOB></DOBs>
			<Nationalities><Nationality>Afghanistan</Nationality></Nationalities>
			<Positions><Position>First Deputy, Council of Ministers</Position></Positions>
			<BirthDetails><Location><TownOfBirth>Pashmul</TownOfBirth><CountryOfBirth>Afghanistan</CountryOfBirth></Location></BirthDetails>
			<Genders><Gender>Male</Gender></Genders>
		</Individual></IndividualDetails>
	</Designation>
	<Designation>
		<UniqueID>RUS0001</UniqueID>
		<OFSIGroupID>7172</OFSIGroupID>
		<Names><Name><Name1>MOHAMMAD</Name1><Name2>HASSAN</Name2><Name6>AKHUND</Name6><NameType>Primary name</NameType></Name></Names>
		<RegimeName>Another Regime</RegimeName>
		<IndividualEntityShip>Individual</IndividualEntityShip>
	</Designation>
	<Designation>
		<UniqueID>RUS1500</UniqueID>
		<Names><Name><Name6>OCEAN STAR</Name6><NameType>Primary name variation</NameType></Name></Names>
		<RegimeName>The Russia (Sanctions) (EU Exit) Regulations 2019</RegimeName>
		<IndividualEntityShip>Ship</IndividualEntityShip>
	</Designation>
</Designations>`

describe('parseUkSanctionsXml', () => {
	const entities = parseUkSanctionsXml(XML)

	it('merges designations of the same OFSI group and keeps the old OFSI id', () => {
		assert.equal(entities.length, 2)
		const person = entities.find((e) => e.id === 'uk-7172')
		assert.ok(person)
		assert.deepEqual(person.programs, ['The Afghanistan (Sanctions) (EU Exit) Regulations 2020', 'Another Regime'])
		assert.deepEqual(person.names, [
			{ full: 'MOHAMMAD HASSAN AKHUND', isPrimary: true },
			{ full: 'Mullah Hassan', isPrimary: false },
			{ full: 'محمد حسن آخوند', isPrimary: false },
		])
	})

	it('keeps the identifiers in the OFAC shape', () => {
		const person = entities.find((e) => e.id === 'uk-7172')
		assert.equal(person.type, 'Individual')
		assert.equal(person.role, 'First Deputy, Council of Ministers')
		assert.deepEqual(person.nationalities, ['Afghanistan'])
		assert.deepEqual(person.addressCountries, ['Afghanistan'])
		assert.deepEqual(person.placesOfBirth, ['Pashmul, Afghanistan'])
		assert.deepEqual(person.genders, ['Male'])
		assert.deepEqual(person.birthDates.map((d) => [d.from, d.to, d.approximate]), [['1945-01-01', '1945-12-31', true], ['1946-03-14', '1946-03-14', false]])
	})

	it('maps ships to vessels, falls back to the unique id and promotes a lone variation to primary', () => {
		const ship = entities.find((e) => e.id === 'uk-RUS1500')
		assert.equal(ship.type, 'Vessel')
		assert.deepEqual(ship.names, [{ full: 'OCEAN STAR', isPrimary: true }])
	})

	it('throws on an unexpected document instead of returning an empty list', () => {
		assert.throws(() => parseUkSanctionsXml('<ArrayOfFinancialSanctionsTarget/>'), /unexpected XML shape/)
	})
})

describe('parseUkDate', () => {
	it('turns unknown day or month into a range', () => {
		assert.deepEqual(parseUkDate('dd/02/1980'), { value: 'dd/02/1980', from: '1980-02-01', to: '1980-02-29', approximate: true })
		assert.deepEqual(parseUkDate('dd/mm/1980'), { value: 'dd/mm/1980', from: '1980-01-01', to: '1980-12-31', approximate: true })
		assert.equal(parseUkDate(''), null)
	})
})
