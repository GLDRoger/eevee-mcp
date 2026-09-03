import type { Metadata } from 'next'
import { Workbench } from '@/components/workbench'

export const metadata: Metadata = {
  title: 'EEVEE Workbench',
}

export default function WorkbenchPage() {
  return <Workbench />
}
