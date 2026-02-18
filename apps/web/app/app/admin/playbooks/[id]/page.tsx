'use client';

import { useEffect, useRef, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { GripVertical, Trash2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';

type Stage = {
  id: string;
  position: number;
  name: string;
  goals: string | null;
  checklistJson: string[];
};

type Playbook = {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
};

const INPUT = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

export default function PlaybookEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Stage> & { checklistInput: string }>({
    checklistInput: '',
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState('');

  const dragIndex = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  async function load() {
    const res = await fetch(`/api/playbooks/${id}`);
    if (!res.ok) { router.push('/app/admin/playbooks'); return; }
    const data: Playbook = await res.json();
    setPlaybook(data);
    setStages(data.stages);
    setNameEdit(data.name);
  }

  useEffect(() => { load(); }, [id]);

  function openStage(stage: Stage) {
    if (expandedId === stage.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(stage.id);
    setEditDraft({
      name: stage.name,
      goals: stage.goals ?? '',
      checklistJson: [...stage.checklistJson],
      checklistInput: '',
    });
  }

  async function saveStage(stageId: string) {
    setSaving(stageId);
    const res = await fetch(`/api/playbook-stages/${stageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editDraft.name,
        goals: editDraft.goals || null,
        checklistJson: editDraft.checklistJson,
      }),
    });
    setSaving(null);
    if (res.ok) {
      const updated: Stage = await res.json();
      setStages((prev) => prev.map((s) => (s.id === stageId ? updated : s)));
      setExpandedId(null);
      showFlash('Stage saved');
    }
  }

  async function deleteStage(stageId: string) {
    const res = await fetch(`/api/playbook-stages/${stageId}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setStages((prev) => prev.filter((s) => s.id !== stageId));
      if (expandedId === stageId) setExpandedId(null);
      showFlash('Stage deleted');
    }
  }

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    if (!newStageName.trim()) return;
    const res = await fetch(`/api/playbooks/${id}/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newStageName.trim() }),
    });
    if (res.ok) {
      const stage: Stage = await res.json();
      setStages((prev) => [...prev, stage]);
      setNewStageName('');
      setAddingStage(false);
      showFlash('Stage added');
    }
  }

  async function saveName() {
    if (!nameEdit.trim() || nameEdit === playbook?.name) { setEditingName(false); return; }
    const res = await fetch(`/api/playbooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameEdit.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPlaybook((prev) => prev && { ...prev, name: updated.name });
      showFlash('Name updated');
    }
    setEditingName(false);
  }

  async function setDefault() {
    const res = await fetch(`/api/playbooks/${id}/set-default`, { method: 'POST' });
    if (res.ok) {
      setPlaybook((prev) => prev && { ...prev, isDefault: true });
      showFlash('Set as default');
    }
  }

  function addChecklistItem() {
    const val = editDraft.checklistInput?.trim();
    if (!val || (editDraft.checklistJson?.length ?? 0) >= 20) return;
    setEditDraft((d) => ({
      ...d,
      checklistJson: [...(d.checklistJson ?? []), val],
      checklistInput: '',
    }));
  }

  function removeChecklistItem(idx: number) {
    setEditDraft((d) => ({
      ...d,
      checklistJson: (d.checklistJson ?? []).filter((_, i) => i !== idx),
    }));
  }

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    dragOver.current = index;
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...stages];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = index;
    setStages(next);
  }

  async function handleDragEnd() {
    dragIndex.current = null;
    dragOver.current = null;
    await fetch(`/api/playbooks/${id}/stages/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: stages.map((s) => s.id) }),
    });
  }

  if (!playbook) {
    return (
      <div className="p-8 max-w-2xl space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameEdit}
              onChange={(e) => setNameEdit(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              maxLength={100}
              className="text-xl font-semibold bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full"
            />
          ) : (
            <h1
              className="text-xl font-semibold text-white cursor-pointer hover:text-slate-300 transition-colors truncate"
              onClick={() => setEditingName(true)}
              title="Click to rename"
            >
              {playbook.name}
            </h1>
          )}
          <button
            onClick={() => router.push('/app/admin/playbooks')}
            className="text-xs text-slate-500 hover:text-slate-400 mt-1"
          >
            ← All playbooks
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {flash && <span className="text-xs text-emerald-400">{flash}</span>}
          {!playbook.isDefault && (
            <button
              onClick={setDefault}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
            >
              Set as default
            </button>
          )}
          {playbook.isDefault && (
            <span className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-500/15 text-emerald-400">
              Default
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {stages.map((stage, index) => (
          <div
            key={stage.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
          >
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-slate-800/40 transition-colors"
              onClick={() => openStage(stage)}
            >
              <GripVertical
                size={16}
                className="text-slate-600 cursor-grab active:cursor-grabbing shrink-0"
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-xs text-slate-600 font-mono w-5 shrink-0">{index + 1}</span>
              <span className="flex-1 text-sm font-medium text-white truncate">{stage.name}</span>
              {stage.checklistJson.length > 0 && (
                <span className="text-xs text-slate-500 shrink-0">
                  {stage.checklistJson.length} checklist item{stage.checklistJson.length !== 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); deleteStage(stage.id); }}
                className="p-1 text-slate-600 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 size={14} />
              </button>
              {expandedId === stage.id ? (
                <ChevronUp size={14} className="text-slate-500 shrink-0" />
              ) : (
                <ChevronDown size={14} className="text-slate-500 shrink-0" />
              )}
            </div>

            {expandedId === stage.id && (
              <div className="px-5 pb-5 pt-2 border-t border-slate-800 space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1.5">Stage name</label>
                  <input
                    className={INPUT}
                    value={editDraft.name ?? ''}
                    onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                    maxLength={100}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1.5">Goals</label>
                  <textarea
                    rows={2}
                    className={`${INPUT} resize-none`}
                    value={editDraft.goals ?? ''}
                    onChange={(e) => setEditDraft((d) => ({ ...d, goals: e.target.value }))}
                    placeholder="What should the rep accomplish in this stage?"
                    maxLength={500}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1.5">
                    Checklist ({editDraft.checklistJson?.length ?? 0}/20)
                  </label>
                  <div className="space-y-1.5 mb-2">
                    {(editDraft.checklistJson ?? []).map((item, i) => (
                      <div key={i} className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
                        <span className="flex-1 text-sm text-white">{item}</span>
                        <button
                          onClick={() => removeChecklistItem(i)}
                          className="text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {(editDraft.checklistJson?.length ?? 0) < 20 && (
                    <div className="flex gap-2">
                      <input
                        className={INPUT}
                        value={editDraft.checklistInput ?? ''}
                        onChange={(e) => setEditDraft((d) => ({ ...d, checklistInput: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
                        placeholder="Add item (Enter to add)"
                        maxLength={200}
                      />
                      <button
                        onClick={addChecklistItem}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => saveStage(stage.id)}
                  disabled={saving === stage.id}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {saving === stage.id ? 'Saving…' : 'Save stage'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {addingStage ? (
        <form onSubmit={addStage} className="mt-3 flex gap-2">
          <input
            autoFocus
            required
            maxLength={100}
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            placeholder="Stage name"
            className={`flex-1 ${INPUT}`}
          />
          <button
            type="submit"
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAddingStage(false); setNewStageName(''); }}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAddingStage(true)}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-slate-700 hover:border-slate-500 text-slate-500 hover:text-slate-300 text-sm rounded-xl transition-colors"
        >
          <Plus size={14} />
          Add stage
        </button>
      )}
    </div>
  );
}
