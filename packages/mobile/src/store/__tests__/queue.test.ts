import { beforeEach, describe, expect, it, vi } from 'vitest'

/** In-memory stand-in for AsyncStorage. */
const store = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v) },
    removeItem: async (k: string) => { store.delete(k) },
  },
}))

const submit = vi.fn()
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return { ...actual, api: { ...actual.api, submit: (...a: unknown[]) => submit(...a) } }
})

const { useQueue } = await import('../queue')
const { ApiError, OfflineError } = await import('../../api/client')

const payload = (batchRef: string) => ({
  batchRef,
  type: 'takeaway' as const,
  lines: [{ itemId: 'item-1', qty: 1 }],
  employeeId: 'emp-1',
})

beforeEach(() => {
  store.clear()
  submit.mockReset()
  useQueue.setState({ pending: [], rejected: [], draining: false, hydrated: true })
})

describe('offline queue', () => {
  it('holds orders while the counter is unreachable', async () => {
    submit.mockRejectedValue(new OfflineError())
    await useQueue.getState().enqueue(payload('b1'))
    await useQueue.getState().drain()

    expect(useQueue.getState().pending).toHaveLength(1)
    expect(useQueue.getState().rejected).toHaveLength(0)
  })

  it('sends everything once the counter is back', async () => {
    submit.mockRejectedValue(new OfflineError())
    await useQueue.getState().enqueue(payload('b1'))
    await useQueue.getState().enqueue(payload('b2'))
    await useQueue.getState().drain()
    expect(useQueue.getState().pending).toHaveLength(2)

    submit.mockResolvedValue({ order: null, duplicate: false })
    await useQueue.getState().drain()
    expect(useQueue.getState().pending).toHaveLength(0)
    // One failed attempt (drain stops at the first offline error rather than
    // hammering a dead hub with the whole queue), then two successes.
    expect(submit).toHaveBeenCalledTimes(3)
  })

  it('sends oldest first so the kitchen gets rounds in order', async () => {
    submit.mockResolvedValue({ order: null, duplicate: false })
    await useQueue.getState().enqueue(payload('first'))
    await useQueue.getState().enqueue(payload('second'))
    await useQueue.getState().drain()

    const refs = submit.mock.calls.map((c) => (c[0] as { batchRef: string }).batchRef)
    expect(refs).toEqual(['first', 'second'])
  })

  it('replays the same batchRef, so a lost reply cannot double the order', async () => {
    // The hub answers "duplicate" — it already has this batch.
    submit.mockResolvedValue({ order: null, duplicate: true })
    await useQueue.getState().enqueue(payload('b1'))
    await useQueue.getState().drain()

    expect((submit.mock.calls[0]![0] as { batchRef: string }).batchRef).toBe('b1')
    expect(useQueue.getState().pending).toHaveLength(0)
  })

  it('sets a rejected order aside instead of losing it silently', async () => {
    submit.mockRejectedValue(new ApiError('Rahul is not permitted to save without a KOT.', 'forbidden', 403))
    await useQueue.getState().enqueue(payload('b1'))
    await useQueue.getState().drain()

    expect(useQueue.getState().pending).toHaveLength(0)
    expect(useQueue.getState().rejected).toHaveLength(1)
    expect(useQueue.getState().rejected[0]!.error).toMatch(/not permitted/i)
  })

  it('keeps later orders queued when one is rejected', async () => {
    submit
      .mockRejectedValueOnce(new ApiError('bad', 'conflict', 409))
      .mockResolvedValueOnce({ order: null, duplicate: false })
    await useQueue.getState().enqueue(payload('bad'))
    await useQueue.getState().enqueue(payload('good'))
    await useQueue.getState().drain()

    expect(useQueue.getState().rejected).toHaveLength(1)
    expect(useQueue.getState().pending).toHaveLength(0)
  })

  it('survives an app restart', async () => {
    submit.mockRejectedValue(new OfflineError())
    await useQueue.getState().enqueue(payload('b1'))
    await useQueue.getState().drain()

    // Simulate a cold start: state cleared, storage kept.
    useQueue.setState({ pending: [], rejected: [], hydrated: false })
    await useQueue.getState().hydrate()
    expect(useQueue.getState().pending).toHaveLength(1)
    expect(useQueue.getState().pending[0]!.payload.batchRef).toBe('b1')
  })

  it('does not drain concurrently', async () => {
    let resolve: (v: unknown) => void = () => {}
    submit.mockImplementation(() => new Promise((r) => { resolve = r }))
    await useQueue.getState().enqueue(payload('b1'))

    const a = useQueue.getState().drain()
    const b = useQueue.getState().drain()   // must be a no-op while draining
    resolve({ order: null, duplicate: false })
    await Promise.all([a, b])

    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe('pairing', () => {
  it('keeps orders queued when the tablet has been unpaired', async () => {
    submit.mockRejectedValue(new ApiError('This tablet has been unpaired.', 'unpaired', 401))
    await useQueue.getState().enqueue(payload('b1'))
    await useQueue.getState().drain()

    expect(useQueue.getState().pending).toHaveLength(1)
    expect(useQueue.getState().rejected).toHaveLength(0)
  })

  it('still sets an expired-licence order aside with its reason', async () => {
    submit.mockRejectedValue(new ApiError('The free trial has ended, so a new order cannot be started.', 'licence_expired', 402))
    await useQueue.getState().enqueue(payload('b1'))
    await useQueue.getState().drain()

    expect(useQueue.getState().rejected[0]!.error).toMatch(/trial has ended/i)
  })
})
