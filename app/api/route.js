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

        const xmlText = fs.readFileSync(path.join(process.cwd(), 'public', 'SDN.XML'), 'utf-8')
        const parser = new XMLParser()
        const xmlData = parser.parse(xmlText)

        // Aquí haces el match contra xmlData según tu lógica
        const found = JSON.stringify(xmlData).includes(name) // Búsqueda básica
        const message = found ? 'Name found in OFAC list' : 'Name not found in OFAC list'

        return NextResponse.json({ match: found, message, searchedName: name })

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