import { appStringsA } from './strings-app-a'
import { appStringsB } from './strings-app-b'

export const appStrings = { ...appStringsA, ...appStringsB } as const
