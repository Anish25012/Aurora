import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { appCache } from '../lib/cache'

afterEach(() => {
  cleanup()
  appCache.clear() // each test starts with nothing cached
  localStorage.clear()
})
