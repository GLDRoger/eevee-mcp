import { appStrings1 } from './strings-app'
import { ribbonStrings1 } from './strings-ribbon'
import { ribbonStrings2 } from './strings-ribbon-2'
import { panesStrings1 } from './strings-panes'

export const strings = { ...appStrings1, ...ribbonStrings1, ...ribbonStrings2, ...panesStrings1 } as const
