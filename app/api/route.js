import { NextResponse } from 'next/server'
import { XMLParser } from 'fast-xml-parser'

import fs from 'fs'
import path from 'path'

export async function GET(request) {

    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    try {
        // const command = new GetObjectCommand({
        //     Bucket: process.env.CLOUDFLARE_R2_BUCKET,
        //     Key: 'SDN.XML' // Cambia por tu key real
        // })
        // const { Body } = await r2Client.send(command)

        // const xmlText = await streamToString(Body)
        // const parser = new XMLParser()
        // const xmlData = parser.parse(xmlText)

        // const xmlText = fs.readFileSync(path.join(process.cwd(), 'public', 'SDN.XML'), 'utf-8')
        // Load from fetch the xml file from the url
        const response = await fetch(`${process.env.BASE_URL}/SDN.XML`)
        const xmlText = await response.text()
        const parser = new XMLParser()
        const xmlData = parser.parse(xmlText)

        // Aquí haces el match contra xmlData según tu lógica
        const found = JSON.stringify(xmlData).includes(name) // Búsqueda básica
        const message = found ? 'Name found in OFAC list' : 'Name not found in OFAC list'
        // const additionalInfo = found ? 'Additional information: ' + xmlData.find(item => item.name === name).additionalInfo : ''

        // console.log(xmlData.sanctionsData)
        // console.log(xmlData.sanctionsData.referenceValues.referenceValue)
        // console.log(xmlData.sanctionsData.featureTypes.featureType)
        // console.log(xmlData.sanctionsData.entities.entity)
        // console.log(xmlData.sanctionsData.entities.entity)

        // If found, then do a more robust search against the xmlData.sanctionsData.entities.entity[].names.name[]
        const foundEntity = xmlData.sanctionsData.entities.entity.find(entity => {

            // Check if entity has names array
            if (!entity.names?.name) return false

            // Handle both single name and array of names
            const names = Array.isArray(entity.names.name) ? entity.names.name : [entity.names.name]

            return names.some(nameObj => {
                // Check if name has translations
                if (!nameObj.translations?.translation) return false

                // Handle both single translation and array of translations
                const translations = Array.isArray(nameObj.translations.translation) ? nameObj.translations.translation : [nameObj.translations.translation]

                // Check formattedFullName, formattedLastName, and formattedFirstName
                return translations.some(translation => {
                    // Convert all values to strings and handle null/undefined
                    const fullName = String(translation.formattedFullName || '')
                    const lastName = String(translation.formattedLastName || '')
                    const firstName = String(translation.formattedFirstName || '')
                    return fullName.includes(name) || lastName.includes(name) || firstName.includes(name)
                })
            })
        })

        return NextResponse.json({
            match: found,
            message,
            searchedName: name,
            foundEntity: foundEntity
        })

    } catch (error) {
        console.error('Error reading R2 XML:', error)
        return NextResponse.json({ error: 'Failed to fetch XML file' }, { status: 500 })
    }
}

// Convertir el stream del Body a string
async function streamToString(stream) {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf-8')
}