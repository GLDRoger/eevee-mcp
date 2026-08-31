import { appStrings } from './strings-app'
import { dialogStrings } from './strings-dialogs'

export const strings = { ...appStrings, ...dialogStrings } as const
