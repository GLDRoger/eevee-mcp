import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const avara = localFont({
  src: '../../public/fonts/AvaraVariable.woff2',
  variable: '--font-avara',
  display: 'swap',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'EEVEE | Agents build the app. You hold the key.',
  description:
    'A WebMCP workbench where a browser agent builds, tests, and runs small apps, and a person approves publishing and every consequential write with a passkey.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={avara.variable}>
      <body>{children}</body>
    </html>
  )
}
