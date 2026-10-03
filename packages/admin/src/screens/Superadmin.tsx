import { useCallback, useEffect, useState } from 'react'
import { ApiError, superadmin, type AdminRow, type InventoryGroup, type TrialUnit } from '../api/client'
import type { LicenceStatus } from '../api/types'
import { Banner, Button, Field, Modal, Pill, inputStyle } from '../components/ui'
import { timeLeft } from '../licence'

/**
 * Superadmin — this unit's admins, its licence, and clearing it for handover.
 *
 * Two situations: first-time setup (add the first admin, start the trial), and
 * every admin PIN forgotten so nobody can sign in at the counter. Reached by
 * first-run setup or the hidden shortcut, only from the counter PC, and only
 * with the superadmin password.
 */
export function Superadmin({ onExit }: { onExit: () => void }) {
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<AdminRow | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [view, setView] = useState<'admins' | 'licence' | 'data'>('admins')
  const [licence, setLicence] = useState<LicenceStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [rows, lic] = await Promise.all([superadmin.admins(), superadmin.licence()])
      setAdmins(rows)
      setLicence(lic)
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
              Admins and licence of this restaurant. Use this to set the hub up, or when an admin has forgotten their PIN.
            </div>
          </div>
          <Button onClick={() => setChangingPassword(true)}>Change password</Button>
          <Button variant="primary" onClick={onExit}>Leave</Button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {([['admins', 'Admins'], ['licence', 'Licence'], ['data', 'Clear data']] as const).map(([id, label]) => (
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

        <SetupChecklist
          admins={admins}
          licence={licence}
          onAddAdmin={() => { setView('admins'); setAdding(true) }}
          onLicence={() => setView('licence')}
        />

        {view === 'licence' ? (
          <LicencePanel
            status={licence}
            onChanged={(next, message) => { setLicence(next); setNotice(message); setError(null) }}
            onError={setError}
          />
        ) : view === 'admins' ? (
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
          subtitle="Give them this starting PIN. They can change it after signing in (click their name at the top)."
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

/**
 * Shown until the hub is usable: someone who can sign in, and time on the
 * clock. A fresh install starts with neither — there is no default admin and
 * no automatic trial.
 */
function SetupChecklist({ admins, licence, onAddAdmin, onLicence }: {
  admins: AdminRow[]
  licence: LicenceStatus | null
  onAddAdmin: () => void
  onLicence: () => void
}) {
  if (!licence) return null
  const hasAdmin = admins.some((a) => a.active && a.hasPin)
  const hasTime = licence.state === 'trial' || licence.state === 'active'
  if (hasAdmin && hasTime) return null

  const step = (done: boolean, label: string, action: string, onClick: () => void) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        width: 22, height: 22, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700,
        background: done ? 'var(--success)' : 'transparent', color: done ? 'var(--on-primary)' : 'var(--text-muted)',
        border: done ? 'none' : '2px solid var(--border-strong)',
      }}>{done ? '✓' : ''}</span>
      <span style={{ flex: 1, fontWeight: 600, opacity: done ? 0.6 : 1 }}>{label}</span>
      {done ? null : <Button variant="primary" onClick={onClick}>{action}</Button>}
    </div>
  )

  return (
    <div className="card" style={{ padding: 20, display: 'grid', gap: 12, borderColor: 'var(--primary)' }}>
      <div>
        <div style={{ fontWeight: 600 }}>Finish setting up this hub</div>
        <div className="muted" style={{ fontSize: 13 }}>Nobody can take orders until both are done.</div>
      </div>
      {step(hasAdmin, 'Add the first admin with a starting PIN', 'Add admin', onAddAdmin)}
      {step(
        hasTime,
        licence.state === 'expired' ? 'The trial or licence has ended — grant more time' : 'Start the trial or activate a licence key',
        'Open Licence',
        onLicence,
      )}
    </div>
  )
}

const UNITS: TrialUnit[] = ['minutes', 'hours', 'days']

/**
 * The superadmin's licence controls. A trial replaces any earlier trial and
 * runs from now; minutes and hours exist so expiry can be tested in a sitting.
 * A paid licence key can also be activated here during setup.
 */
function LicencePanel({ status, onChanged, onError }: {
  status: LicenceStatus | null
  onChanged: (next: LicenceStatus, message: string) => void
  onError: (message: string) => void
}) {
  const [value, setValue] = useState('30')
  const [unit, setUnit] = useState<TrialUnit>('days')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const amount = Number(value)
  const valid = value !== '' && Number.isInteger(amount) && amount > 0

  const act = async (fn: () => Promise<LicenceStatus>, message: (s: LicenceStatus) => string) => {
    setBusy(true)
    try {
      const next = await fn()
      onChanged(next, message(next))
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <div className="muted">Loading…</div>

  const until = status.expiresAt
    ? new Date(status.expiresAt).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    : null
  const pill = {
    unlicensed: { label: 'Not licensed', tone: 'danger' as const },
    trial: { label: 'Trial', tone: 'info' as const },
    active: { label: 'Licensed', tone: 'success' as const },
    expired: { label: 'Expired', tone: 'danger' as const },
  }[status.state]
  const trialRunning = status.plan === 'trial' && status.state === 'trial'

  return (
    <>
      <div className="card" style={{ padding: 20, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>
            {status.state === 'unlicensed'
              ? 'No trial or licence yet'
              : status.state === 'expired'
                ? `Ended ${until}`
                : `${status.plan === 'paid' ? `Licensed${status.customer ? ` to ${status.customer}` : ''}` : 'Trial'} — ${timeLeft(status.msLeft)} left`}
          </div>
          <Pill label={pill.label} tone={pill.tone} />
        </div>
        {until && status.state !== 'expired' ? <div className="muted">Until {until}</div> : null}
        <div className="muted" style={{ fontSize: 13 }}>
          Install ID <code style={{ userSelect: 'all' }}>{status.installId}</code>
        </div>
      </div>

      <div className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Trial</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Runs from now and replaces any earlier trial. Minutes and hours are for testing expiry.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Length">
            <input
              style={{ ...inputStyle, width: 120 }}
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </Field>
          <Field label="Unit">
            <select style={{ ...inputStyle, width: 140 }} value={unit} onChange={(e) => setUnit(e.target.value as TrialUnit)}>
              {UNITS.map((u) => <option key={u} value={u}>{u[0]!.toUpperCase() + u.slice(1)}</option>)}
            </select>
          </Field>
          <Button
            variant="primary"
            disabled={busy || !valid}
            onClick={() => void act(() => superadmin.grantTrial(amount, unit), (s) => `Trial set — ${timeLeft(s.msLeft)} from now.`)}
          >
            {trialRunning ? 'Replace trial' : 'Start trial'}
          </Button>
          {trialRunning ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void act(() => superadmin.grantTrial(0, 'minutes'), () => 'Trial ended. New orders and shifts are now blocked.')}
            >
              End trial now
            </Button>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Licence key</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Made for this install ID with the licence generator. If both a key and a trial are present, whichever runs later counts.
          </div>
        </div>
        <textarea
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="POS1.…"
          rows={3}
          spellCheck={false}
          style={{
            padding: 12, border: '1px solid var(--border-strong)', borderRadius: 'var(--r-input)',
            fontFamily: 'ui-monospace, monospace', fontSize: 13, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            disabled={busy || key.trim() === ''}
            onClick={() => void act(
              () => superadmin.installLicence(key),
              (s) => { setKey(''); return `Licence activated — ${timeLeft(s.msLeft)} left.` },
            )}
          >
            Activate key
          </Button>
        </div>
      </div>
    </>
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
  const ready = name.trim() !== '' && /^\d{4}$/.test(pin)

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} width={480}>
      {fixedName ? null : (
        <Field label="Name">
          <input style={inputStyle} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field label="PIN (4 digits)">
        <input
          style={{ ...inputStyle, letterSpacing: 6, fontSize: 20 }}
          value={pin}
          autoFocus={!!fixedName}
          inputMode="numeric"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
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
