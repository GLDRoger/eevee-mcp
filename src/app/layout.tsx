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
  title: 'EEVEE MCP',
  description: 'A durable workspace for people and browser agents.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={avara.variable}>
      <body>{children}</body>
    </html>
  )
}
