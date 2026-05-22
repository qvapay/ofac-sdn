export const metadata = {
	title: 'OFAC SDN Screening API',
	description: 'API-only endpoint for screening names against the U.S. Treasury OFAC SDN list.',
}

export default function RootLayout({ children }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
