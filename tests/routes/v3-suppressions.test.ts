import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from '@/app/v3/[siteId]/suppressions/[type]/[email]/route'

describe('/v3/[siteId]/suppressions/[type]/[email] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should acknowledge bounce suppression removal', async () => {
    const response = await DELETE({} as Request, {
      params: Promise.resolve({
        siteId: 'example.com',
        type: 'bounces',
        email: encodeURIComponent('reader@example.com'),
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.message).toBe('Suppression list item has been removed')
  })

  it('should acknowledge complaint suppression removal', async () => {
    const response = await DELETE({} as Request, {
      params: Promise.resolve({
        siteId: 'example.com',
        type: 'complaints',
        email: encodeURIComponent('reader@example.com'),
      }),
    })

    expect(response.status).toBe(200)
  })

  it('should acknowledge unsubscribe suppression removal', async () => {
    const response = await DELETE({} as Request, {
      params: Promise.resolve({
        siteId: 'example.com',
        type: 'unsubscribes',
        email: encodeURIComponent('reader@example.com'),
      }),
    })

    expect(response.status).toBe(200)
  })

  it('should reject unknown suppression types', async () => {
    const response = await DELETE({} as Request, {
      params: Promise.resolve({
        siteId: 'example.com',
        type: 'unknown',
        email: encodeURIComponent('reader@example.com'),
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.message).toBe('suppression type is invalid')
  })
})
