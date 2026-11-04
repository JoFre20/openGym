// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareText } from './share.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shareText', () => {
  it('hands the text to the browser share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })

    expect(await shareText('https://gym.example/#/social?friend=A7X-92B', { title: 'openGym' })).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'openGym', text: 'https://gym.example/#/social?friend=A7X-92B' })
  })

  it('copies nothing when the share sheet is dismissed', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' }))
    vi.stubGlobal('navigator', { share })

    expect(await shareText('https://gym.example/#/social?friend=A7X-92B')).toBe('cancelled')
  })

  it('copies the link when the browser has no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    expect(await shareText('https://gym.example/#/social?friend=A7X-92B')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://gym.example/#/social?friend=A7X-92B')
  })

  it('reports a copy that failed', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    expect(await shareText('https://gym.example/#/social?friend=A7X-92B')).toBe('failed')
  })
})
