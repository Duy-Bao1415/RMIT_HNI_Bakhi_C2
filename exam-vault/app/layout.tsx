import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import {
  TideCloakProvider
} from '@tidecloak/nextjs'
import tcConfig from '../tidecloak.json'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Zero-Leak Exam Vault',
  description: 'A shared exam bank where nobody sees the exam early - secured by TideCloak',
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <TideCloakProvider config={tcConfig}>
          {children}
        </TideCloakProvider>
      </body>
    </html>
  )
}
