'use client';

import { useEffect, useState } from 'react';
import { Role } from '@live-sales-coach/shared';

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  createdAt: string;
};

const ROLE_BADGE: Record<Role, string> = {
  ADMIN: 'bg-violet-500/15 text-violet-400',
  MANAGER: 'bg-blue-500/15 text-blue-400',
  REP: 'bg-slate-700 text-slate-300',
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400',
  INVITED: 'bg-yellow-500/15 text-yellow-400',
  DISABLED: 'bg-slate-700 text-slate-500',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-slate-400">{label}</label>
      {children}
    </div>
  );
}

const INPUT = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
const SELECT = INPUT;

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [error, setError] = useState('');

  const [addForm, setAddForm] = useState({ name: '', email: '', role: Role.REP, password: '' });
  const [editForm, setEditForm] = useState({ role: Role.REP, status: 'ACTIVE' as User['status'] });
  const [submitting, setSubmitting] = useState(false);

  async function loadUsers() {
    const res = await fetch('/api/users');
    const data = await res.json();
    setUsers(data);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.message ?? 'Failed to create user');
    } else {
      setShowAdd(false);
      setAddForm({ name: '', email: '', role: Role.REP, password: '' });
      await loadUsers();
    }
    setSubmitting(false);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setSubmitting(true);
    setError('');
    const res = await fetch(`/api/users/${editUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.message ?? 'Failed to update user');
    } else {
      setEditUser(null);
      await loadUsers();
    }
    setSubmitting(false);
  }

  function openEdit(u: User) {
    setEditUser(u);
    setEditForm({ role: u.role, status: u.status === 'INVITED' ? 'ACTIVE' : u.status });
    setError('');
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-white">Users</h1>
          <p className="text-sm text-slate-500 mt-1">{users.length} member{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setError(''); }}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Add user
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">No users yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Name</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Email</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Role</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Joined</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3.5 text-white font-medium">{u.name}</td>
                  <td className="px-5 py-3.5 text-slate-400">{u.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_BADGE[u.role]}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[u.status] ?? ''}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => openEdit(u)}
                      className="text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <Modal title="Add user" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} className="space-y-4">
            <Field label="Name">
              <input
                required
                className={INPUT}
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="Jane Smith"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                required
                className={INPUT}
                value={addForm.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                placeholder="jane@company.com"
              />
            </Field>
            <Field label="Role">
              <select
                className={SELECT}
                value={addForm.role}
                onChange={(e) => setAddForm({ ...addForm, role: e.target.value as Role })}
              >
                <option value={Role.REP}>Rep</option>
                <option value={Role.MANAGER}>Manager</option>
                <option value={Role.ADMIN}>Admin</option>
              </select>
            </Field>
            <Field label="Password">
              <input
                type="password"
                required
                minLength={8}
                className={INPUT}
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                placeholder="Min. 8 characters"
              />
            </Field>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {submitting ? 'Creating…' : 'Create user'}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && (
        <Modal title={`Edit ${editUser.name}`} onClose={() => setEditUser(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <Field label="Role">
              <select
                className={SELECT}
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}
              >
                <option value={Role.REP}>Rep</option>
                <option value={Role.MANAGER}>Manager</option>
                <option value={Role.ADMIN}>Admin</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                className={SELECT}
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as User['status'] })}
              >
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </Field>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {submitting ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
