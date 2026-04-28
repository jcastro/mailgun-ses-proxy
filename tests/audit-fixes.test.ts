import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests covering all 10 audit findings.
 * Each test group targets one specific issue.
 * Tests are written to pass AFTER fixes are applied.
 */

// ============================================================
// Issue 1: AWS clients should be singletons (awsHelper.ts)
// We unmock the AWS SDK so the real awsHelper module runs
// ============================================================
vi.unmock('@aws-sdk/client-sqs')
vi.unmock('@aws-sdk/client-sesv2')
vi.unmock('@/service/newsletter-service')
vi.unmock('@/lib/core/aws-utils')

describe('Issue 1: AWS client singletons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('SES_REGION', 'us-east-1')
    vi.stubEnv('SES_TRANSACTIONAL_REGION', 'us-east-1')
    vi.stubEnv('SQS_REGION', 'us-east-1')
  })

  it('sqsClient() should return the same instance on multiple calls', async () => {
    const { sqsClient } = await import('@/service/aws/awsHelper')
    const client1 = sqsClient()
    const client2 = sqsClient()
    expect(client1).toBe(client2)
  })

  it('sesNewsletterClient() should return the same instance on multiple calls', async () => {
    const { sesNewsletterClient } = await import('@/service/aws/awsHelper')
    const client1 = sesNewsletterClient()
    const client2 = sesNewsletterClient()
    expect(client1).toBe(client2)
  })

  it('sesSystemClient() should return the same instance on multiple calls', async () => {
    const { sesSystemClient } = await import('@/service/aws/awsHelper')
    const client1 = sesSystemClient()
    const client2 = sesSystemClient()
    expect(client1).toBe(client2)
  })
})

// ============================================================
// Issue 2: createNewsletterErrorEntry swapped params (db.ts)
// ============================================================
describe('Issue 2: createNewsletterErrorEntry parameter order', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should store error as the error column and siteId as messageId', async () => {
    const mockCreate = vi.fn().mockResolvedValue({})
    vi.doMock('@/lib/database', () => ({
      prisma: {
        newsletterErrors: { create: mockCreate },
      },
    }))

    const { createNewsletterErrorEntry } = await import('@/service/database/db')

    const messageId = 'temp-msg-id-123'
    const errorMessage = 'SES rate limit exceeded'
    const batchId = 'batch-456'
    const toEmail = 'test@example.com'
    const recipientData = '{}'

    await createNewsletterErrorEntry(messageId, errorMessage, batchId, toEmail, recipientData)

    const createArg = mockCreate.mock.calls[0][0]
    // The error column should contain the actual error message
    expect(createArg.data.error).toBe(errorMessage)
    // The messageId column should NOT contain the error message
    expect(createArg.data.messageId).not.toBe(errorMessage)
  })
})

// ============================================================
// Issue 3: sendMail should handle null content (newsletter-service.ts)
// ============================================================
describe('Issue 3: sendMail null content handling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('validateAndSend should not crash when newsletter content is null', async () => {
    const mockSqsSend = vi.fn().mockResolvedValue({})
    vi.doMock('@/service/aws/awsHelper', () => ({
      sqsClient: () => ({ send: mockSqsSend }),
      sesNewsletterClient: () => ({ send: vi.fn() }),
      QUEUE_URL: { NEWSLETTER: 'https://sqs.example.com/newsletter' },
    }))
    vi.doMock('@/service/database/db', () => ({
      getNewsletterContent: vi.fn().mockResolvedValue(null),
      createNewsletterBatchEntry: vi.fn(),
      createNewsletterEntry: vi.fn(),
      createNewsletterErrorEntry: vi.fn(),
      saveNewsletterNotification: vi.fn(),
      getNewsletterSentRecipients: vi.fn().mockResolvedValue(new Set()),
      getActiveSuppressedRecipients: vi.fn().mockResolvedValue(new Map()),
      shouldPersistNewsletterFormattedContents: vi.fn().mockReturnValue(false),
    }))
    vi.doMock('@/lib/core/logger', () => ({
      default: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      },
    }))

    const { validateAndSend } = await import('@/service/newsletter-service')

    const message = {
      MessageId: 'msg-1',
      Body: 'nonexistent-batch-id',
      ReceiptHandle: 'receipt-1',
      MessageAttributes: {
        siteId: { StringValue: 'site-1', DataType: 'String' },
        from: { StringValue: 'test@example.com', DataType: 'String' },
      },
      Attributes: { ApproximateReceiveCount: '1' },
    } as any

    // Should not throw — should handle null content gracefully
    await validateAndSend(message)
  })
})

// ============================================================
// Issue 4: Invalid messages should be marked for deletion by the SQS worker (newsletter-service.ts)
// ============================================================
describe('Issue 4: Invalid messages marked for SQS deletion', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should delete message with missing MessageAttributes from SQS', async () => {
    const mockSqsSend = vi.fn().mockResolvedValue({})
    vi.doMock('@aws-sdk/client-sesv2', () => ({
      SendEmailCommand: vi.fn(),
      SendBulkEmailCommand: vi.fn(),
    }))
    vi.doMock('@/service/aws/awsHelper', () => ({
      sqsClient: () => ({ send: mockSqsSend }),
      sesNewsletterClient: () => ({ send: vi.fn() }),
      QUEUE_URL: { NEWSLETTER: 'https://sqs.example.com/newsletter' },
    }))
    vi.doMock('@/service/database/db', () => ({
      getNewsletterContent: vi.fn(),
      createNewsletterBatchEntry: vi.fn(),
      createNewsletterEntry: vi.fn(),
      createNewsletterErrorEntry: vi.fn(),
      saveNewsletterNotification: vi.fn(),
      getNewsletterSentRecipients: vi.fn().mockResolvedValue(new Set()),
      getActiveSuppressedRecipients: vi.fn().mockResolvedValue(new Map()),
      shouldPersistNewsletterFormattedContents: vi.fn().mockReturnValue(false),
    }))
    vi.doMock('@/lib/core/logger', () => ({
      default: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      },
    }))

    const { validateAndSend } = await import('@/service/newsletter-service')

    const message = {
      MessageId: 'msg-bad',
      Body: 'some-body',
      ReceiptHandle: 'receipt-bad',
      // Missing MessageAttributes
    } as any

    const result = await validateAndSend(message)

    // The worker deletes invalid messages after the handler marks them as safe to discard.
    expect(result).toBe('delete')
    expect(mockSqsSend).not.toHaveBeenCalled()
  })

  it('should delete message with missing siteId attribute from SQS', async () => {
    const mockSqsSend = vi.fn().mockResolvedValue({})
    vi.doMock('@aws-sdk/client-sesv2', () => ({
      SendEmailCommand: vi.fn(),
      SendBulkEmailCommand: vi.fn(),
    }))
    vi.doMock('@/service/aws/awsHelper', () => ({
      sqsClient: () => ({ send: mockSqsSend }),
      sesNewsletterClient: () => ({ send: vi.fn() }),
      QUEUE_URL: { NEWSLETTER: 'https://sqs.example.com/newsletter' },
    }))
    vi.doMock('@/service/database/db', () => ({
      getNewsletterContent: vi.fn(),
      createNewsletterBatchEntry: vi.fn(),
      createNewsletterEntry: vi.fn(),
      createNewsletterErrorEntry: vi.fn(),
      saveNewsletterNotification: vi.fn(),
      getNewsletterSentRecipients: vi.fn().mockResolvedValue(new Set()),
      getActiveSuppressedRecipients: vi.fn().mockResolvedValue(new Map()),
      shouldPersistNewsletterFormattedContents: vi.fn().mockReturnValue(false),
    }))
    vi.doMock('@/lib/core/logger', () => ({
      default: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      },
    }))

    const { validateAndSend } = await import('@/service/newsletter-service')

    const message = {
      MessageId: 'msg-bad-2',
      Body: 'some-body',
      ReceiptHandle: 'receipt-bad-2',
      MessageAttributes: {
        from: { StringValue: 'test@example.com', DataType: 'String' },
        // Missing siteId
      },
    } as any

    const result = await validateAndSend(message)
    expect(result).toBe('delete')
    expect(mockSqsSend).not.toHaveBeenCalled()
  })
})

// ============================================================
// Issue 5: parseNotificationEvent timestamp fallback (aws-utils.ts)
// ============================================================
describe('Issue 5: parseNotificationEvent timestamp', () => {
  it('should use mail.timestamp for non-open events instead of new Date()', async () => {
    vi.resetModules()
    const { parseNotificationEvent } = await import('@/lib/core/aws-utils')

    const mailTimestamp = '2025-06-15T10:30:00Z'
    const event = JSON.stringify({
      eventType: 'Delivery',
      mail: { messageId: 'ses-msg-1', timestamp: mailTimestamp },
    })

    const result = parseNotificationEvent('notif-1', event)

    // Should use mail.timestamp, NOT new Date()
    const resultTime = new Date(result.timestamp).getTime()
    const mailTime = new Date(mailTimestamp).getTime()
    expect(resultTime).toBe(mailTime)
  })

  it('should use open.timestamp for Open events', async () => {
    vi.resetModules()
    const { parseNotificationEvent } = await import('@/lib/core/aws-utils')

    const openTimestamp = '2025-06-15T12:00:00Z'
    const event = JSON.stringify({
      eventType: 'Open',
      mail: { messageId: 'ses-msg-2', timestamp: '2025-06-15T10:30:00Z' },
      open: { timestamp: openTimestamp },
    })

    const result = parseNotificationEvent('notif-2', event)

    const resultTime = new Date(result.timestamp).getTime()
    const openTime = new Date(openTimestamp).getTime()
    expect(resultTime).toBe(openTime)
  })

  it('should use click.timestamp for Click events', async () => {
    vi.resetModules()
    const { parseNotificationEvent } = await import('@/lib/core/aws-utils')

    const clickTimestamp = '2025-06-15T12:15:00Z'
    const event = JSON.stringify({
      eventType: 'Click',
      mail: { messageId: 'ses-msg-3', timestamp: '2025-06-15T10:30:00Z' },
      click: { timestamp: clickTimestamp, link: 'https://example.com/post' },
    })

    const result = parseNotificationEvent('notif-3', event)

    const resultTime = new Date(result.timestamp).getTime()
    const clickTime = new Date(clickTimestamp).getTime()
    expect(result.type).toBe('clicked')
    expect(resultTime).toBe(clickTime)
  })

  it('should parse SNS-wrapped SES events', async () => {
    vi.resetModules()
    const { parseNotificationEvent } = await import('@/lib/core/aws-utils')

    const event = JSON.stringify({
      Type: 'Notification',
      Message: JSON.stringify({
        eventType: 'Delivery',
        mail: { messageId: 'ses-msg-4', timestamp: '2025-06-15T10:30:00Z' },
        delivery: { timestamp: '2025-06-15T10:31:00Z' },
      }),
    })

    const result = parseNotificationEvent('notif-4', event)

    expect(result.type).toBe('delivered')
    expect(result.messageId).toBe('ses-msg-4')
    expect(new Date(result.timestamp).toISOString()).toBe('2025-06-15T10:31:00.000Z')
  })
})

describe('Mailgun-compatible analytics formatting', () => {
  it('should expose SES click details as Mailgun clicked events', async () => {
    vi.resetModules()
    const { formatAsMailgunEvent } = await import('@/lib/core/aws-utils')

    const result = formatAsMailgunEvent([{
      id: 'event-id',
      type: 'clicked',
      messageId: 'ses-msg-click',
      timestamp: new Date('2025-06-15T12:15:00Z'),
      created: new Date('2025-06-15T12:16:00Z'),
      rawEvent: JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({
          eventType: 'Click',
          mail: { messageId: 'ses-msg-click', timestamp: '2025-06-15T10:30:00Z' },
          click: {
            timestamp: '2025-06-15T12:15:00Z',
            link: 'https://example.com/post',
            ipAddress: '203.0.113.10',
            userAgent: 'Example Mail Client',
          },
        }),
      }),
      newsletter: {
        toEmail: 'reader@example.com',
        newsletterBatch: { batchId: 'ghost-email-id' },
      },
    } as any], 'https://proxy.example/v3/site/events')

    expect(result.items[0].event).toBe('clicked')
    expect(result.items[0].url).toBe('https://example.com/post')
    expect(result.items[0]['client-info']?.['user-agent']).toBe('Example Mail Client')
    expect(result.items[0]['user-variables']?.['email-id']).toBe('ghost-email-id')
    expect(result.pages.next.page).toBe('0')
  })

  it('should expose SES bounce codes in Mailgun failed events', async () => {
    vi.resetModules()
    const { formatAsMailgunEvent } = await import('@/lib/core/aws-utils')

    const result = formatAsMailgunEvent([{
      id: 'event-id',
      type: 'failed',
      messageId: 'ses-msg-bounce',
      timestamp: new Date('2025-06-15T12:15:00Z'),
      created: new Date('2025-06-15T12:16:00Z'),
      rawEvent: JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({
          eventType: 'Bounce',
          mail: { messageId: 'ses-msg-bounce', timestamp: '2025-06-15T10:30:00Z' },
          bounce: {
            bounceType: 'Permanent',
            bouncedRecipients: [{ status: '5.1.1' }],
          },
        }),
      }),
      newsletter: {
        toEmail: 'missing@example.com',
        newsletterBatch: { batchId: 'ghost-email-id' },
      },
    } as any], 'https://proxy.example/v3/site/events')

    expect(result.items[0].event).toBe('failed')
    expect(result.items[0]['delivery-status']?.code).toBe(605)
    expect(result.items[0]['delivery-status']?.['enhanced-code']).toBe('5.1.1')
  })

  it('should keep SES transient bounces as temporary failures', async () => {
    vi.resetModules()
    const { formatAsMailgunEvent } = await import('@/lib/core/aws-utils')

    const result = formatAsMailgunEvent([{
      id: 'event-id',
      type: 'failed',
      messageId: 'ses-msg-bounce',
      timestamp: new Date('2025-06-15T12:15:00Z'),
      created: new Date('2025-06-15T12:16:00Z'),
      rawEvent: JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({
          eventType: 'Bounce',
          mail: { messageId: 'ses-msg-bounce', timestamp: '2025-06-15T10:30:00Z' },
          bounce: {
            bounceType: 'Transient',
            bouncedRecipients: [{ status: '4.4.7' }],
          },
        }),
      }),
      newsletter: {
        toEmail: 'delayed@example.com',
        newsletterBatch: { batchId: 'ghost-email-id' },
      },
    } as any], 'https://proxy.example/v3/site/events')

    expect(result.items[0].event).toBe('failed')
    expect(result.items[0].severity).toBe('temporary')
    expect(result.items[0].reason).toBe('temporary-bounce')
    expect(result.items[0]['delivery-status']?.code).toBe(400)
    expect(result.items[0]['delivery-status']?.['enhanced-code']).toBe('4.4.7')
  })

  it('should expose SES delivery delay events as temporary Mailgun failures', async () => {
    vi.resetModules()
    const { formatAsMailgunEvent } = await import('@/lib/core/aws-utils')

    const result = formatAsMailgunEvent([{
      id: 'event-id',
      type: 'failed',
      messageId: 'ses-msg-delay',
      timestamp: new Date('2025-06-15T12:15:00Z'),
      created: new Date('2025-06-15T12:16:00Z'),
      rawEvent: JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({
          eventType: 'DeliveryDelay',
          mail: { messageId: 'ses-msg-delay', timestamp: '2025-06-15T10:30:00Z' },
          deliveryDelay: {
            delayType: 'TransientCommunicationFailure',
            delayedRecipients: [{ status: '4.4.1' }],
          },
        }),
      }),
      newsletter: {
        toEmail: 'slow@example.com',
        newsletterBatch: { batchId: 'ghost-email-id' },
      },
    } as any], 'https://proxy.example/v3/site/events')

    expect(result.items[0].event).toBe('failed')
    expect(result.items[0].severity).toBe('temporary')
    expect(result.items[0].reason).toBe('TransientCommunicationFailure')
    expect(result.items[0]['delivery-status']?.['enhanced-code']).toBe('4.4.1')
  })

  it('should expose Mailgun.js-compatible next page ids', async () => {
    vi.resetModules()
    const { formatAsMailgunEvent } = await import('@/lib/core/aws-utils')

    const result = formatAsMailgunEvent([], 'https://proxy.example/v3/site/events?event=opened&start=300&page=300')

    expect(result.paging.next).toContain('page=300')
    expect(result.pages.next.page).toBe('300')
  })
})

describe('Mailgun-compatible analytics query parsing', () => {
  it('should accept Mailgun.js page tokens as an offset', async () => {
    vi.resetModules()
    const { validateQueryParams } = await import('@/service/events-service/events-utils')

    const params = new URLSearchParams({
      event: 'delivered OR opened',
      begin: '1000',
      end: '2000',
      limit: '300',
      page: '600',
      ascending: 'yes',
    })

    const result = validateQueryParams(params)

    expect(result.start).toBe(600)
    expect(result.order).toBe('asc')
  })

  it('should tolerate missing optional Mailgun event query params', async () => {
    vi.resetModules()
    const { validateQueryParams } = await import('@/service/events-service/events-utils')

    const result = validateQueryParams(new URLSearchParams())

    expect(result.start).toBe(0)
    expect(result.limit).toBe(300)
    expect(result.event).toContain('delivered')
    expect(result.begin).toBe(0)
    expect(result.end).toBeGreaterThan(0)
    expect(result.order).toBe('desc')
  })

  it('should only sort ascending for Mailgun yes-like ascending values', async () => {
    vi.resetModules()
    const { validateQueryParams } = await import('@/service/events-service/events-utils')

    const result = validateQueryParams(new URLSearchParams({ ascending: 'no' }))

    expect(result.order).toBe('desc')
  })
})

describe('Ghost Mailgun message payload compatibility', () => {
  it('should preserve Ghost headers and substitute recipient variables for SES', async () => {
    vi.resetModules()
    vi.stubEnv('NEWSLETTER_CONFIGURATION_SET_NAME', 'newsletter-config-set')
    const { preparePayload } = await import('@/lib/core/aws-utils')

    const payloads = preparePayload({
      to: ['reader@example.com'],
      from: 'Example <noreply@example.com>',
      'h:Reply-To': 'reply@example.com',
      'h:Sender': 'Example <noreply@example.com>',
      'h:Auto-Submitted': 'auto-generated',
      'h:X-Auto-Response-Suppress': 'OOF, AutoReply',
      'h:List-Unsubscribe': '<%recipient.list_unsubscribe%>, <%tag_unsubscribe_email%>',
      'h:List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      subject: 'Hello %recipient.name%',
      html: '<p>Hello %recipient.name%</p>',
      text: 'Hello %recipient.name%',
      'recipient-variables': JSON.stringify({
        'reader@example.com': {
          name: 'Reader',
          list_unsubscribe: 'https://example.com/unsubscribe/reader',
        },
      }),
      'v:email-id': 'ghost-email-id',
    }, 'example.com')

    const request = payloads[0].request
    const headers = request.Content?.Simple?.Headers || []

    expect(request.Destination?.ToAddresses).toEqual(['reader@example.com'])
    expect(request.ReplyToAddresses).toEqual(['reply@example.com'])
    expect(request.Content?.Simple?.Subject?.Data).toBe('Hello Reader')
    expect(request.Content?.Simple?.Body?.Html?.Data).toBe('<p>Hello Reader</p>')
    expect(headers).toContainEqual({
      Name: 'Auto-Submitted',
      Value: 'auto-generated',
    })
    expect(headers).toContainEqual({
      Name: 'X-Auto-Response-Suppress',
      Value: 'OOF, AutoReply',
    })
    expect(headers).toContainEqual({
      Name: 'List-Unsubscribe',
      Value: '<https://example.com/unsubscribe/reader>',
    })
    expect(headers).not.toContainEqual(expect.objectContaining({ Name: 'Sender' }))
  })
})

// ============================================================
// Issue 6: stats route JSON parsing outside try/catch
// ============================================================
describe('Issue 6: stats route error handling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should return 400 for malformed JSON body instead of crashing', async () => {
    vi.doMock('@/lib/core/logger', () => ({
      default: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      },
    }))
    vi.doMock('@/service/stats-service', () => ({
      getNewsletterUsage: vi.fn(),
    }))

    const { POST } = await import('@/app/stats/[action]/route')

    const mockRequest = {
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as unknown as Request

    const mockParams = { params: Promise.resolve({ action: 'getNewsletterUsage' }) }

    const response = await POST(mockRequest, mockParams)

    // Should be a handled error (400), not an unhandled crash
    expect(response.status).toBe(400)
  })
})

// ============================================================
// Issue 7: ErrorHandler.handleApiError ignores context
// ============================================================
describe('Issue 7: ErrorHandler context parameter', () => {
  it('should include context in the error response', async () => {
    vi.resetModules()
    const { ErrorHandler } = await import('@/service/error-handler/error-handler')

    const error = new Error('Something failed')
    const result = ErrorHandler.handleApiError(error, 'email-sending')

    // context should be available in the response
    expect(result).toHaveProperty('context')
    expect(result.context).toBe('email-sending')
  })

  it('should have undefined context when not provided', async () => {
    vi.resetModules()
    const { ErrorHandler } = await import('@/service/error-handler/error-handler')

    const error = new Error('Something failed')
    const result = ErrorHandler.handleApiError(error)

    expect(result.context).toBeUndefined()
  })
})

// ============================================================
// Issue 8: validationError ignores details param (api-response.ts)
// ============================================================
describe('Issue 8: validationError details parameter', () => {
  it('should include details and timestamp in validation error response', async () => {
    vi.resetModules()
    const { ApiResponse } = await import('@/lib/api-response')

    const details = { field: 'email', issue: 'invalid format' }
    const response = ApiResponse.validationError('Validation failed', details)
    const result = await response.json()

    expect(result).toHaveProperty('timestamp')
    expect(result).toHaveProperty('details')
    expect(result.details).toEqual(details)
  })

  it('should work without details parameter', async () => {
    vi.resetModules()
    const { ApiResponse } = await import('@/lib/api-response')

    const response = ApiResponse.validationError('Validation failed')
    const result = await response.json()

    expect(result).toHaveProperty('timestamp')
    expect(result.success).toBe(false)
    expect(result).not.toHaveProperty('details')
  })
})

// ============================================================
// Issue 9: malformed auth header handling (authentication/index.ts)
// ============================================================
describe('Issue 9: authentication malformed header', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('API_KEY', 'test-key-123')
  })

  it('should return false for header with no space (bare token)', async () => {
    vi.doMock('@/lib/core/logger', () => ({
      default: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      },
    }))

    const { authentication } = await import('@/lib/authentication/index')
    // Should not throw, should return false
    const result = await authentication('BearerNoSpace')
    expect(result).toBe(false)
  })

  it('should return false for empty string token', async () => {
    vi.doMock('@/lib/core/logger', () => ({
      default: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      },
    }))

    const { authentication } = await import('@/lib/authentication/index')
    const result = await authentication('')
    expect(result).toBe(false)
  })
})

// ============================================================
// Issue 10: timing-safe API key comparison (authentication/index.ts)
// ============================================================
describe('Issue 10: timing-safe API key comparison', () => {
  it('authentication module should use timingSafeEqual instead of ===', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const authSource = fs.readFileSync(
      path.resolve(__dirname, '../lib/authentication/index.ts'),
      'utf-8'
    )
    // Should use timingSafeEqual for constant-time comparison
    expect(authSource).toContain('timingSafeEqual')
    // Should NOT use === for key comparison (raw === validKey pattern)
    expect(authSource).not.toMatch(/raw\s*===\s*validKey/)
  })
})
