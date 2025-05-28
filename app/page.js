"use client"

import { useState } from "react"

// TODO: Implement the API call to the OFAC API
export default function OFACChecker() {

  const [searchTerm, setSearchTerm] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [result, setResult] = useState(null)
  const [showResult, setShowResult] = useState(false)

  // Search function
  const performSearch = async () => {
    if (!searchTerm.trim()) return
    setIsSearching(true)
    setShowResult(false)
    setResult(null)

    try {
      const response = await fetch(`/api?name=${encodeURIComponent(searchTerm)}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to perform search')
      }

      const searchResult = {
        type: data.match ? "positive" : "negative",
        name: searchTerm,
        message: data.message
      }

      setResult(searchResult)
    } catch (error) {
      console.error('Search error:', error)
      setResult({
        type: "error",
        name: searchTerm,
        message: "An error occurred while searching. Please try again."
      })
    } finally {
      setIsSearching(false)
      // Trigger result animation
      setTimeout(() => setShowResult(true), 100)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      performSearch()
    }
  }

  // Get the result icon
  const getResultIcon = () => {
    if (!result) return null
    switch (result.type) {
      case "negative":
        return (
          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
            ✓
          </div>
        )
      case "positive":
        return (
          <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
            !
          </div>
        )
      case "partial":
        return (
          <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
            ?
          </div>
        )
    }
  }

  // Get the result color
  const getResultColor = () => {
    if (!result) return ""
    switch (result.type) {
      case "negative":
        return "border-green-200 bg-green-50"
      case "positive":
        return "border-red-200 bg-red-50"
      case "partial":
        return "border-yellow-200 bg-yellow-50"
    }
  }

  // Get the result title
  const getResultTitle = () => {
    if (!result) return ""
    switch (result.type) {
      case "negative":
        return "No Match Found"
      case "positive":
        return "Potential Match Detected"
      case "partial":
        return "Partial Match Found"
    }
  }

  // Get the result description
  const getResultDescription = () => {
    if (!result) return ""
    switch (result.type) {
      case "negative":
        return "The searched name does not appear on the OFAC SDN list."
      case "positive":
        return "High confidence match found. Please review carefully."
      case "partial":
        return "Possible matches found. Manual review recommended."
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-indigo-600/10" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
          <div className="text-center">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100 text-blue-800 text-sm font-medium mb-8">
              <span className="mr-2">⚠️</span>
              OFAC Compliance Screening
            </div>

            <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
              SDN List
              <span className="block text-blue-600">Screening Tool</span>
            </h1>

            <p className="text-xl text-gray-600 mb-12 max-w-3xl mx-auto">
              Screen individuals and entities against the Office of Foreign Assets Control Specially Designated
              Nationals list for compliance verification.
            </p>

            {/* Search Section */}
            <div className="max-w-2xl mx-auto">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
                  <span className="text-gray-400 text-xl">🔍</span>
                </div>
                <input
                  type="text"
                  placeholder="Enter name to search (e.g., John Smith, Maria Gonzalez)"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="w-full pl-14 pr-4 py-6 text-lg rounded-2xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isSearching}
                />
              </div>

              <button onClick={performSearch} disabled={!searchTerm.trim() || isSearching} className="mt-6 px-8 py-6 text-lg rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg text-white font-medium transition-colors duration-200 flex items-center justify-center mx-auto">
                {isSearching ? (
                  <>
                    <div className="w-5 h-5 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Searching OFAC Database...
                  </>
                ) : (
                  <>
                    <span className="mr-2">🔍</span>
                    Search SDN List
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results Section */}
      {result && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <div className={`${getResultColor()} border-2 rounded-lg shadow-lg transition-all duration-500 transform ${showResult ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
            <div className="p-8">
              <div className="flex items-center justify-center mb-6">
                <div className="animate-pulse">{getResultIcon()}</div>
              </div>

              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{getResultTitle()}</h2>
                <p className="text-gray-600 text-lg">{result.message || getResultDescription()}</p>
              </div>

              <div className="bg-white rounded-lg p-6 mb-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-gray-500">SEARCHED TERM</span>
                  <span className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full border">
                    {new Date().toLocaleString()}
                  </span>
                </div>
                <p className="text-xl font-semibold text-gray-900">{result.name}</p>
              </div>

              {result.type === "error" && (
                <div className="mt-8 p-4 bg-red-50 rounded-lg">
                  <p className="text-sm text-red-600 text-center">
                    {result.message}
                  </p>
                </div>
              )}

              {result.matches && result.matches.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Found {result.matches.length} potential match{result.matches.length > 1 ? "es" : ""}:
                  </h3>

                  {result.matches.map((match, index) => (
                    <div
                      key={index}
                      className={`bg-white rounded-lg p-6 border-l-4 shadow-sm transition-all duration-300 ${showResult ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"} ${match.score >= 90 ? "border-red-400" : "border-yellow-400"}`} style={{ transitionDelay: `${index * 100}ms` }} >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-lg font-semibold text-gray-900">{match.name}</h4>
                        <div className="flex items-center space-x-2">
                          <span className={`px-3 py-1 text-sm font-medium rounded-full ${match.score >= 90 ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`} >
                            {match.score}% Match
                          </span>
                          <span className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full border">
                            {match.program}
                          </span>
                        </div>
                      </div>

                      {match.aliases && match.aliases.length > 0 && (
                        <div>
                          <span className="text-sm font-medium text-gray-500">Known Aliases: </span>
                          <span className="text-sm text-gray-700">{match.aliases.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-8 p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 text-center">
                  <strong>Disclaimer:</strong> This tool uses the official OFAC SDN list for compliance screening.
                  For official verification, please consult with legal counsel and use official OFAC resources.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-gray-50 border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-sm text-gray-500">
            <p>© 2024 OFAC SDN Screening Tool. For demonstration purposes only.</p>
            <p className="mt-2">
              Official OFAC resources:
              <a href="https://sanctionssearch.ofac.treas.gov/" className="text-blue-600 hover:underline ml-1">
                OFAC Sanctions Search
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}