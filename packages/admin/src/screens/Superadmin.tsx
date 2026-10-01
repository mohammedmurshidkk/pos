import { useCallback, useEffect, useState } from 'react'
import { ApiError, superadmin, type AdminRow, type InventoryGroup } from '../api/client'
import { Banner, Button, Field, Modal, Pill, inputStyle } from '../components/ui'

/**
 * Superadmin — managing this unit's admins, and nothing else.
 *
 * It exists for one situation: every admin PIN has been forgotten, and nobody
 * can sign in at the counter. Reached only by the hidden shortcut, only from
 * the counter PC, and only with the superadmin password.
 */
export function Superadmin({ onExit }: { onExit: () => void }) {
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<AdminRow | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [view, setView] = useState<'admins' | 'data'>('admins')

  const refresh = useCallback(async () => {
    try {
      setAdmins(await superadmin.admins())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
      // The session has expired — drop back rather than showing an empty screen.
      if (e instanceof ApiError && e.status === 403) setTimeout(onExit, 1500)
    }
  }, [onExit])

  useEffect(() => { void refresh() }, [refresh])

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      setNotice(message)
      setError(null)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 24 }}>
      <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1>Superadmin</h1>
              <Pill label="Counter PC only" tone="danger" />
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              Manage the admins of this restaurant. Use this when an admin has forgotten their PIN.
            </div>
          </div>
          <Button onClick={() => setChangingPassword(true)}>Change password</Button>
          <Button variant="primary" onClick={onExit}>Leave</Button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {([['admins', 'Admins'], ['data', 'Clear data']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setView(id); setError(null); setNotice(null) }}
              style={{
                height: 'var(--row-h)', padding: '0 16px', cursor: 'pointer', fontWeight: 600,
                borderRadius: 'var(--r-button)',
                border: `1px solid ${view === id ? 'var(--primary)' : 'var(--border)'}`,
                background: view === id ? 'var(--primary-subtle)' : 'var(--surface)',
                color: view === id ? 'var(--primary)' : 'var(--text-muted)',
              }}
            >{label}</button>
          ))}
        </div>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}

        {view === 'admins' ? (
          <>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={() => setAdding(true)}>Add admin</Button>
        </div>

        <div className="card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Status', 'PIN', ''].map((h, i) => (
                  <th key={h || i} style={{
                    textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
                    textTransform: 'uppercase', color: 'var(--text-muted)', padding: '10px 12px',
                    borderBottom: '1px solid var(--border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} style={{ height: 'var(--row-h)', borderTop: '1px solid var(--border)', opacity: a.active ? 1 : 0.5 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.name}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {a.active ? <Pill label="Active" tone="success" /> : <span className="faint">Disabled</span>}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {a.hasPin ? <span className="muted">Set</span> : <Pill label="No PIN" tone="warning" />}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button variant="ghost" onClick={() => setResetting(a)}>Reset PIN</Button>
                    <Button
                      variant="ghost"
                      onClick={() => void run(() => superadmin.setActive(a.id, !a.active),
                        `${a.name} is now ${a.active ? 'disabled' : 'active'}.`)}
                    >
                      {a.active ? 'Disable' : 'Enable'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="faint" style={{ fontSize: 13 }}>
          Admins are never deleted, only disabled — past orders and reports still refer to them.
        </div>
          </>
        ) : (
          <ClearData onDone={(message) => { setNotice(message); setError(null); void refresh() }} onError={setError} />
        )}
      </div>

      {adding ? (
        <NameAndPin
          title="Add admin"
          subtitle="They can sign in at the counter straight away."
          onClose={() => setAdding(false)}
          onSubmit={(name, pin) => {
            setAdding(false)
            void run(() => superadmin.createAdmin(name, pin), `${name} can now sign in.`)
          }}
        />
      ) : null}

      {resetting ? (
        <NameAndPin
          title={`Reset ${resetting.name}'s PIN`}
          subtitle="Give them the new PIN in person, then ask them to change it."
          fixedName={resetting.name}
          onClose={() => setResetting(null)}
          onSubmit={(_n, pin) => {
            const target = resetting
            setResetting(null)
            void run(() => superadmin.resetPin(target.id, pin), `${target.name}'s PIN has been reset.`)
          }}
        />
      ) : null}

      {changingPassword ? (
        <ChangePassword
          onClose={() => setChangingPassword(false)}
          onSubmit={(password) => {
            setChangingPassword(false)
            void run(() => superadmin.setPassword(password), 'Superadmin password changed.')
          }}
        />
      ) : null}
    </div>
  )
}

function NameAndPin({ title, subtitle, fixedName, onClose, onSubmit }: {
  title: string
  subtitle: string
  fixedName?: string
  onClose: () => void
  onSubmit: (name: string, pin: string) => void
}) {
  const [name, setName] = useState(fixedName ?? '')
  const [pin, setPin] = useState('')
  const ready = name.trim() !== '' && /^\d{4,6}$/.test(pin)

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} width={480}>
      {fixedName ? null : (
        <Field label="Name">
          <input style={inputStyle} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field label="PIN (4 to 6 digits)">
        <input
          style={{ ...inputStyle, letterSpacing: 6, fontSize: 20 }}
          value={pin}
          autoFocus={!!fixedName}
          inputMode="numeric"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) onSubmit(name, pin) }}
        />
      </Field>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready} onClick={() => onSubmit(name, pin)}>Save</Button>
      </div>
    </Modal>
  )
}

function ChangePassword({ onClose, onSubmit }: { onClose: () => void; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const ready = password.length >= 8 && password === again

  return (
    <Modal
      title="Change superadmin password"
      subtitle="At least 8 characters. Write it down — it is stored hashed and cannot be read back."
      onClose={onClose}
      width={480}
    >
      <Field label="New password">
        <input style={inputStyle} type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Type it again">
        <input
          style={inputStyle} type="password" value={again}
          onChange={(e) => setAgain(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) onSubmit(password) }}
        />
      </Field>
      {again !== '' && password !== again ? <Banner tone="warning">The two passwords do not match.</Banner> : null}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready} onClick={() => onSubmit(password)}>Change password</Button>
      </div>
    </Modal>
  )
}

/**
 * Clearing the hub before handing it to a shop.
 *
 * Groups clear in dependency order — printers cannot go while kitchens still
 * print through them — and the hub says which one to do first rather than
 * failing with a database error. "Clear everything" ignores the order because
 * the whole graph goes at once.
 */
function ClearData({ onDone, onError }: { onDone: (message: string) => void; onError: (m: string) => void }) {
  const [groups, setGroups] = useState<InventoryGroup[]>([])
  const [confirming, setConfirming] = useState<InventoryGroup | 'all' | null>(null)

  const refresh = useCallback(async () => {
    try {
      setGroups(await superadmin.inventory())
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [onError])

  useEffect(() => { void refresh() }, [refresh])

  const clear = async (target: InventoryGroup | 'all') => {
    setConfirming(null)
    try {
      const result = await superadmin.clear(target === 'all' ? 'all' : target.id)
      await refresh()
      onDone(
        `${result.cleared} cleared — ${result.rows} row${result.rows === 1 ? '' : 's'} removed.` +
        (result.backupPath ? ' A backup was saved first.' : ''),
      )
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  const total = groups.reduce((n, g) => n + g.count, 0)

  return (
    <>
      <div className="card" style={{ display: 'grid' }}>
        {groups.map((g, i) => (
          <div
            key={g.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: 16,
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              opacity: g.count === 0 ? 0.55 : 1,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{g.label}</div>
              <div className="muted" style={{ fontSize: 13 }}>{g.description}</div>
              {g.blockedBy && g.count > 0 ? (
                <div style={{ fontSize: 13, color: 'var(--warning)', marginTop: 4 }}>{g.blockedBy}</div>
              ) : null}
            </div>
            <div className="money" style={{ minWidth: 60 }}>{g.count}</div>
            <Button
              variant="danger"
              disabled={g.count === 0 || g.blockedBy != null}
              onClick={() => setConfirming(g)}
            >
              Clear
            </Button>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 20, borderColor: 'var(--danger)', display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Clear everything</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Every printer, kitchen, counter, menu item, table, employee and all sales history —
            {' '}{total} row{total === 1 ? '' : 's'} in total. The licence, the trial clock and this
            superadmin password are kept, so you can sign back in and set the shop up again.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="danger" disabled={total === 0} onClick={() => setConfirming('all')}>
            Clear everything
          </Button>
        </div>
      </div>

      {confirming ? (
        <ConfirmClear
          target={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={() => void clear(confirming)}
        />
      ) : null}
    </>
  )
}

function ConfirmClear({ target, onClose, onConfirm }: {
  target: InventoryGroup | 'all'
  onClose: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const all = target === 'all'
  // Typing the word is the brake: everything here is irreversible in the UI.
  const ready = !all || typed.trim().toUpperCase() === 'CLEAR'

  return (
    <Modal
      title={all ? 'Clear everything?' : `Clear ${target.label.toLowerCase()}?`}
      subtitle={all
        ? 'This removes every setting and all sales history on this hub. A backup is written first.'
        : `${target.count} row${target.count === 1 ? '' : 's'} will be deleted. A backup is written first.`}
      onClose={onClose}
      width={520}
    >
      {all ? (
        <Field label="Type CLEAR to confirm">
          <input
            style={inputStyle}
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready) onConfirm() }}
          />
        </Field>
      ) : null}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={!ready} onClick={onConfirm}>
          {all ? 'Clear everything' : 'Clear'}
        </Button>
      </div>
    </Modal>
  )
}
