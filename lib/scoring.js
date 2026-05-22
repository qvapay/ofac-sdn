// Name-matching score utilities tuned for OFAC SDN screening.
//
// The exposed `score()` returns 0–100. We combine Jaro–Winkler (great for
// prefix-similar names, typos, transliterations) with a token-set ratio
// (so word order and extra tokens don't tank the score). The max of the
// two is what callers see — fuzzy AML systems commonly use this hybrid.

export function normalize(input) {
    if (input == null) return ''
    return String(input)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function tokenize(input) {
    const n = typeof input === 'string' ? input : normalize(input)
    if (!n) return []
    return n.split(' ')
}

function jaroSimilarity(s1, s2) {
    if (s1 === s2) return 1
    const len1 = s1.length
    const len2 = s2.length
    if (len1 === 0 || len2 === 0) return 0

    const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1)
    const s1Matches = new Array(len1).fill(false)
    const s2Matches = new Array(len2).fill(false)
    let matches = 0

    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchDistance)
        const end = Math.min(i + matchDistance + 1, len2)
        for (let j = start; j < end; j++) {
            if (s2Matches[j]) continue
            if (s1[i] !== s2[j]) continue
            s1Matches[i] = true
            s2Matches[j] = true
            matches++
            break
        }
    }
    if (matches === 0) return 0

    let transpositions = 0
    let k = 0
    for (let i = 0; i < len1; i++) {
        if (!s1Matches[i]) continue
        while (!s2Matches[k]) k++
        if (s1[i] !== s2[k]) transpositions++
        k++
    }

    return (
        matches / len1 +
        matches / len2 +
        (matches - transpositions / 2) / matches
    ) / 3
}

export function jaroWinkler(s1, s2, prefixScale = 0.1, maxPrefix = 4) {
    const j = jaroSimilarity(s1, s2)
    if (j === 0) return 0
    let prefix = 0
    const limit = Math.min(maxPrefix, s1.length, s2.length)
    for (let i = 0; i < limit; i++) {
        if (s1[i] === s2[i]) prefix++
        else break
    }
    return j + prefix * prefixScale * (1 - j)
}

// rapidfuzz-style token set ratio. Splits each string into a set of tokens,
// computes intersection + the two diffs, builds three "sorted strings" and
// takes the best Jaro–Winkler similarity among them. This makes word order
// and extra middle names / suffixes mostly free.
export function tokenSetRatio(s1, s2) {
    const set1 = new Set(tokenize(s1))
    const set2 = new Set(tokenize(s2))
    if (set1.size === 0 || set2.size === 0) return 0

    const intersection = []
    const diff1 = []
    const diff2 = []
    for (const t of set1) (set2.has(t) ? intersection : diff1).push(t)
    for (const t of set2) if (!set1.has(t)) diff2.push(t)

    const sect = intersection.sort().join(' ')
    const sect1 = (sect + ' ' + diff1.sort().join(' ')).trim()
    const sect2 = (sect + ' ' + diff2.sort().join(' ')).trim()

    // With no shared tokens, the only meaningful comparison is sect1 vs sect2.
    // Don't fall back to comparing strings against themselves — that returns 1.
    if (!sect) return jaroWinkler(sect1, sect2)

    return Math.max(
        jaroWinkler(sect, sect1),
        jaroWinkler(sect, sect2),
        jaroWinkler(sect1, sect2),
    )
}

// Returns an integer 0–100 — the headline score for an API response.
export function score(query, target) {
    const q = normalize(query)
    const t = normalize(target)
    if (!q || !t) return 0
    if (q === t) return 100
    const jw = jaroWinkler(q, t)
    const tsr = tokenSetRatio(q, t)
    return Math.round(Math.max(jw, tsr) * 100)
}
