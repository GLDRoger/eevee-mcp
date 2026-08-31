import { appStrings } from './strings-app'
import { editorStrings } from './strings-editor'
import { ribbonStrings } from './strings-ribbon'

export const strings = { ...appStrings, ...editorStrings, ...ribbonStrings } as const
